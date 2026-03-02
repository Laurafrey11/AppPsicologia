-- ─────────────────────────────────────────────────────────────────────────────
-- import_progress
--
-- Stores sessions that could not be imported in a single call due to monthly
-- quota limits. Written exclusively via supabaseAdmin (service role).
-- RLS is enabled with no client policies.
--
-- UNIQUE (psychologist_id, patient_id): at most one pending import per patient.
-- file_ext: stored so the continue endpoint knows whether to set
--           historical_import_done when the last batch is processed.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS import_progress (
  id                       UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  psychologist_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  patient_id               UUID        NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  file_name                TEXT        NOT NULL DEFAULT '',
  file_ext                 TEXT        NOT NULL DEFAULT '',
  remaining_sessions_json  JSONB       NOT NULL DEFAULT '[]',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (psychologist_id, patient_id)
);

ALTER TABLE import_progress ENABLE ROW LEVEL SECURITY;
-- No RLS policies → all client requests are denied. Service role bypasses RLS.

-- ─────────────────────────────────────────────────────────────────────────────
-- sessions_unique_import
--
-- Partial unique index used by process_import_continue to detect and skip
-- duplicate historical session inserts (ON CONFLICT … DO NOTHING).
-- Scoped to non-null session_date rows; rows without a date are unaffected.
--
-- WARNING: This index will fail to create if any duplicate
-- (psychologist_id, patient_id, session_date) combinations already exist.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS sessions_unique_import
  ON sessions (psychologist_id, patient_id, session_date)
  WHERE session_date IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- process_import_continue
--
-- Atomically processes one continuation batch for a patient's partial import.
-- All DB work happens in a single transaction:
--   0. pg_advisory_xact_lock(hash(psychologist_id:patient_id))
--        → total serialisation per patient pair; blocks before ANY table access.
--   1. SELECT … FOR UPDATE on import_progress   → prevents concurrent continues.
--   2. SELECT … FOR UPDATE on subscription_limits → prevents TOCTOU on quota.
--   3. COUNT sessions this month                 → accurate inside the lock.
--   4. Split remaining into batch + new_remaining.
--   5. INSERT sessions ON CONFLICT … DO NOTHING  → fully idempotent.
--   6. UPDATE usage_tracking.sessions_count      → atomic counter.
--   7. UPDATE or DELETE import_progress          → queue stays consistent.
--
-- Returns JSONB: { imported INT, remaining INT, file_ext TEXT }
--
-- Raises 'IMPORT_NOT_FOUND'       if no import_progress row exists.
-- Raises 'SESSION_LIMIT_EXCEEDED' if the monthly quota is already exhausted.
--
-- SECURITY INVOKER: runs under the service role (via supabaseAdmin.rpc).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION process_import_continue(
  p_psychologist_id UUID,
  p_patient_id      UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_progress       RECORD;
  v_limit_row      RECORD;
  v_current_count  BIGINT;
  v_available      INT;
  v_total          INT;
  v_take           INT;
  v_batch          JSONB;
  v_new_remaining  JSONB;
  v_session        JSONB;
  v_session_date   DATE;
  v_ai_summary     TEXT;
  v_row_count      INT;
  v_imported       INT := 0;
  v_month          TEXT := TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM');
BEGIN
  -- 0. Advisory lock — total serialisation per (psychologist_id, patient_id).
  --    Acquired before ANY table access, including the import_progress FOR UPDATE
  --    below. Guarantees that two concurrent calls for the same patient never
  --    execute any logic in parallel, even when no import_progress row exists yet.
  --
  --    pg_advisory_xact_lock:
  --      • Transaction-level: released automatically at COMMIT / ROLLBACK.
  --      • Exclusive: second caller blocks until first transaction ends.
  --      • Scoped: only serialises the same integer key; different patients
  --        (different hash values) are completely unaffected.
  --      • hashtext: INT4 → implicitly cast to BIGINT for the lock function.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_psychologist_id::text || ':' || p_patient_id::text)
  );

  -- 1. Lock import_progress row — prevents concurrent continue calls.
  SELECT *
    INTO v_progress
    FROM import_progress
   WHERE psychologist_id = p_psychologist_id
     AND patient_id = p_patient_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'IMPORT_NOT_FOUND';
  END IF;

  v_total := jsonb_array_length(v_progress.remaining_sessions_json);

  IF v_total = 0 THEN
    -- Stale row with empty remaining — clean up and return.
    DELETE FROM import_progress
     WHERE psychologist_id = p_psychologist_id
       AND patient_id      = p_patient_id;
    RETURN jsonb_build_object('imported', 0, 'remaining', 0, 'file_ext', v_progress.file_ext);
  END IF;

  -- 2. Ensure limits row exists, then lock it to serialize concurrent inserts.
  INSERT INTO subscription_limits (
    psychologist_id, max_patients, max_sessions_per_month,
    max_audio_minutes, max_ai_assist_per_month
  )
  VALUES (p_psychologist_id, 30, 120, 600, 20)
  ON CONFLICT (psychologist_id) DO NOTHING;

  SELECT max_sessions_per_month
    INTO v_limit_row
    FROM subscription_limits
   WHERE psychologist_id = p_psychologist_id
     FOR UPDATE;

  SELECT COUNT(*)
    INTO v_current_count
    FROM sessions
   WHERE psychologist_id = p_psychologist_id
     AND created_at >= DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC')
     AND created_at <  DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 month';

  IF v_current_count >= v_limit_row.max_sessions_per_month THEN
    RAISE EXCEPTION 'SESSION_LIMIT_EXCEEDED';
  END IF;

  v_available := v_limit_row.max_sessions_per_month - v_current_count::INT;
  v_take      := LEAST(v_available, v_total);

  -- 3. Split remaining into batch (first v_take) and new_remaining (the rest).
  SELECT jsonb_agg(elem ORDER BY idx)
    INTO v_batch
    FROM jsonb_array_elements(v_progress.remaining_sessions_json)
         WITH ORDINALITY AS t(elem, idx)
   WHERE idx <= v_take;

  SELECT COALESCE(jsonb_agg(elem ORDER BY idx), '[]'::JSONB)
    INTO v_new_remaining
    FROM jsonb_array_elements(v_progress.remaining_sessions_json)
         WITH ORDINALITY AS t(elem, idx)
   WHERE idx > v_take;

  IF v_batch IS NULL THEN
    v_batch := '[]'::JSONB;
  END IF;

  -- 4. Insert sessions from batch — ON CONFLICT DO NOTHING for idempotency.
  FOR i IN 0..jsonb_array_length(v_batch) - 1 LOOP
    v_session := v_batch->i;

    BEGIN
      v_session_date := (v_session->>'fecha')::DATE;
    EXCEPTION WHEN OTHERS THEN
      v_session_date := NULL;
    END;

    v_ai_summary := v_session->>'ai_summary';
    IF v_ai_summary IS NOT DISTINCT FROM 'null' OR v_ai_summary = '' THEN
      v_ai_summary := NULL;
    END IF;

    INSERT INTO sessions (
      patient_id, psychologist_id, raw_text, transcription,
      ai_summary, audio_duration, session_notes, session_date
    ) VALUES (
      p_patient_id,
      p_psychologist_id,
      v_session->>'texto',
      NULL,
      v_ai_summary,
      NULL,
      NULL,
      v_session_date
    )
    ON CONFLICT (psychologist_id, patient_id, session_date)
      WHERE session_date IS NOT NULL
      DO NOTHING;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_imported := v_imported + v_row_count;
  END LOOP;

  -- 5. Update or delete import_progress within the same transaction.
  --    This must happen before step 6 so the row is gone / shrunk before
  --    usage_tracking is written — keeps both tables in a consistent state.
  IF jsonb_array_length(v_new_remaining) = 0 THEN
    DELETE FROM import_progress
     WHERE psychologist_id = p_psychologist_id
       AND patient_id      = p_patient_id;
  ELSE
    UPDATE import_progress
       SET remaining_sessions_json = v_new_remaining,
           updated_at              = NOW()
     WHERE psychologist_id = p_psychologist_id
       AND patient_id      = p_patient_id;
  END IF;

  -- 6. Atomically update usage_tracking session counter.
  --    Mirrors the identical block in process_import_initial so both paths
  --    keep usage_tracking.sessions_count in sync.
  IF v_imported > 0 THEN
    INSERT INTO usage_tracking (
      psychologist_id, month, sessions_count, audio_minutes, ai_assist_count, estimated_cost
    )
    VALUES (p_psychologist_id, v_month, v_imported, 0, 0, 0)
    ON CONFLICT (psychologist_id, month)
    DO UPDATE SET sessions_count = usage_tracking.sessions_count + v_imported;
  END IF;

  RETURN jsonb_build_object(
    'imported',  v_imported,
    'remaining', jsonb_array_length(v_new_remaining),
    'file_ext',  v_progress.file_ext
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- process_import_initial
--
-- Fully atomic initial import: every step executes in a single PostgreSQL
-- transaction. No post-commit JS writes required; no crash window.
--
-- Inputs:
--   p_sessions  JSONB  – Array of { fecha TEXT, texto TEXT, ai_summary TEXT|null }
--                        validated and pre-parsed by the route handler.
--   p_file_name TEXT   – Original filename (stored in import_progress if partial).
--   p_file_ext  TEXT   – 'txt' | 'csv' | 'xlsx' | 'xls'  (drives step 7 guard).
--
-- Steps (all within one transaction):
--   0.  pg_advisory_xact_lock(hash(psychologist_id:patient_id))
--         → total serialisation per patient pair; blocks before ANY table access.
--   A.  Guard: historical_import_done IS DISTINCT FROM true
--         → raises HISTORICAL_IMPORT_ALREADY_DONE if flag already set.
--   B.  Guard: COUNT(sessions) < 3 all-time
--         → raises TOO_MANY_EXISTING_SESSIONS if patient already has ≥ 3 sessions.
--   0b. PERFORM … FOR UPDATE on import_progress (if row exists)
--         → serialises concurrent initial calls when a prior partial import exists.
--   1.  INSERT subscription_limits ON CONFLICT DO NOTHING
--       + SELECT … FOR UPDATE on subscription_limits → prevents TOCTOU on quota.
--   2.  COUNT sessions this month                    → accurate inside the lock.
--   3.  Split p_sessions into batch (fits quota) + remaining.
--   4.  INSERT batch ON CONFLICT … DO NOTHING        → fully idempotent.
--   5.  UPDATE usage_tracking.sessions_count         → atomic counter.
--   6.  UPSERT or DELETE import_progress             → queue managed in SQL,
--         not in JS — eliminates the crash window that existed before this refactor.
--   7.  If p_file_ext = 'txt' AND remaining = '[]':
--       UPDATE patients SET historical_import_done = true
--         → flag committed atomically with all prior steps; non-recoverable state
--           (flag false after sessions inserted) is now impossible.
--
-- Returns JSONB: { imported_count INT, remaining_count INT, can_continue BOOL }
--   • remaining_count = 0 / can_continue = false  → all sessions fit in quota.
--   • remaining_count > 0 / can_continue = true   → partial import; continue
--     endpoint will process remaining batches.
--
-- Never raises SESSION_LIMIT_EXCEEDED: when quota = 0, returns imported_count = 0
-- and queues all sessions in import_progress atomically.
--
-- Lock order: advisory → import_progress → subscription_limits → sessions
--             → usage_tracking → import_progress → patients
-- Identical prefix to process_import_continue — no lock inversion, no deadlock.
--
-- SECURITY INVOKER: called via supabaseAdmin (service role).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION process_import_initial(
  p_psychologist_id UUID,
  p_patient_id      UUID,
  p_sessions        JSONB,
  p_file_name       TEXT DEFAULT '',
  p_file_ext        TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_patient_done   BOOLEAN;
  v_existing_count BIGINT;
  v_limit_row      RECORD;
  v_current_count  BIGINT;
  v_available      INT;
  v_total          INT;
  v_take           INT;
  v_batch          JSONB;
  v_new_remaining  JSONB := '[]'::JSONB;
  v_session        JSONB;
  v_session_date   DATE;
  v_ai_summary     TEXT;
  v_row_count      INT;
  v_imported       INT := 0;
  v_month          TEXT := TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM');
BEGIN
  -- 0. Advisory lock — total serialisation per (psychologist_id, patient_id).
  --    Acquired before ANY table access. Guarantees that two concurrent initial
  --    calls for the same patient never execute logic in parallel, even when no
  --    import_progress row exists yet (the PERFORM FOR UPDATE below is a no-op
  --    in that case, but the advisory lock always blocks).
  --
  --    pg_advisory_xact_lock:
  --      • Transaction-level: released automatically at COMMIT / ROLLBACK.
  --      • Exclusive: second caller blocks until first transaction ends.
  --      • Scoped: only serialises the same integer key; different patients
  --        (different hash values) are completely unaffected.
  --      • hashtext: INT4 → implicitly cast to BIGINT for the lock function.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_psychologist_id::text || ':' || p_patient_id::text)
  );

  -- Guard A: one-time import per patient.
  --   Runs inside the advisory lock → no race possible.
  --   Plain SELECT (no FOR UPDATE): historical_import_done is only written by
  --   step 7 of this very function, which is protected by the same advisory lock.
  SELECT historical_import_done
    INTO v_patient_done
    FROM patients
   WHERE id              = p_patient_id
     AND psychologist_id = p_psychologist_id;

  IF v_patient_done IS NOT DISTINCT FROM true THEN
    RAISE EXCEPTION 'HISTORICAL_IMPORT_ALREADY_DONE';
  END IF;

  -- Guard B: only allowed if the patient has fewer than 3 existing sessions (all-time).
  --   COUNT(*) with no date filter — not the monthly window used for quota.
  SELECT COUNT(*)
    INTO v_existing_count
    FROM sessions
   WHERE psychologist_id = p_psychologist_id
     AND patient_id      = p_patient_id;

  IF v_existing_count >= 3 THEN
    RAISE EXCEPTION 'TOO_MANY_EXISTING_SESSIONS';
  END IF;

  -- Fast path: nothing to do.
  IF p_sessions IS NULL THEN
    RETURN jsonb_build_object('imported_count', 0, 'remaining_count', 0, 'can_continue', FALSE);
  END IF;

  v_total := jsonb_array_length(p_sessions);

  IF v_total = 0 THEN
    RETURN jsonb_build_object('imported_count', 0, 'remaining_count', 0, 'can_continue', FALSE);
  END IF;

  -- 0b. Lock import_progress row for this patient if one exists.
  --    Serialises concurrent initial imports for the same patient.
  --    If no row exists this PERFORM touches zero rows and does not block.
  --    (The advisory lock above already prevents true concurrency; this FOR UPDATE
  --    maintains explicit lock-order parity with process_import_continue.)
  --
  --    Lock order: advisory → import_progress → subscription_limits
  --                → sessions → usage_tracking → import_progress → patients
  --    Identical to process_import_continue prefix — no lock inversion, no deadlock.
  PERFORM 1
    FROM import_progress
   WHERE psychologist_id = p_psychologist_id
     AND patient_id      = p_patient_id
     FOR UPDATE;

  -- 1. Ensure limits row exists; then acquire an exclusive row lock to
  --    serialise concurrent imports for the same psychologist.
  INSERT INTO subscription_limits (
    psychologist_id, max_patients, max_sessions_per_month,
    max_audio_minutes, max_ai_assist_per_month
  )
  VALUES (p_psychologist_id, 30, 120, 600, 20)
  ON CONFLICT (psychologist_id) DO NOTHING;

  SELECT max_sessions_per_month
    INTO v_limit_row
    FROM subscription_limits
   WHERE psychologist_id = p_psychologist_id
     FOR UPDATE;

  -- 2. Count sessions created this calendar month (UTC boundaries).
  --    Executed inside the FOR UPDATE lock so the count is consistent.
  SELECT COUNT(*)
    INTO v_current_count
    FROM sessions
   WHERE psychologist_id = p_psychologist_id
     AND created_at >= DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC')
     AND created_at <  DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 month';

  v_available := v_limit_row.max_sessions_per_month - v_current_count::INT;

  IF v_available > 0 THEN

    -- 3. Split: first v_take sessions form the batch; everything else is remaining.
    v_take := LEAST(v_available, v_total);

    SELECT jsonb_agg(elem ORDER BY idx)
      INTO v_batch
      FROM jsonb_array_elements(p_sessions)
           WITH ORDINALITY AS t(elem, idx)
     WHERE idx <= v_take;

    SELECT COALESCE(jsonb_agg(elem ORDER BY idx), '[]'::JSONB)
      INTO v_new_remaining
      FROM jsonb_array_elements(p_sessions)
           WITH ORDINALITY AS t(elem, idx)
     WHERE idx > v_take;

    IF v_batch IS NULL THEN
      v_batch := '[]'::JSONB;
    END IF;

    -- 4. Insert batch — ON CONFLICT DO NOTHING makes every call idempotent.
    FOR i IN 0..jsonb_array_length(v_batch) - 1 LOOP
      v_session := v_batch->i;

      BEGIN
        v_session_date := (v_session->>'fecha')::DATE;
      EXCEPTION WHEN OTHERS THEN
        v_session_date := NULL;
      END;

      v_ai_summary := v_session->>'ai_summary';
      IF v_ai_summary IS NOT DISTINCT FROM 'null' OR v_ai_summary = '' THEN
        v_ai_summary := NULL;
      END IF;

      INSERT INTO sessions (
        patient_id, psychologist_id, raw_text, transcription,
        ai_summary, audio_duration, session_notes, session_date
      ) VALUES (
        p_patient_id,
        p_psychologist_id,
        v_session->>'texto',
        NULL,
        v_ai_summary,
        NULL,
        NULL,
        v_session_date
      )
      ON CONFLICT (psychologist_id, patient_id, session_date)
        WHERE session_date IS NOT NULL
        DO NOTHING;

      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_imported := v_imported + v_row_count;
    END LOOP;

    -- 5. Atomically update usage_tracking session counter.
    IF v_imported > 0 THEN
      INSERT INTO usage_tracking (
        psychologist_id, month, sessions_count, audio_minutes, ai_assist_count, estimated_cost
      )
      VALUES (p_psychologist_id, v_month, v_imported, 0, 0, 0)
      ON CONFLICT (psychologist_id, month)
      DO UPDATE SET sessions_count = usage_tracking.sessions_count + v_imported;
    END IF;

  ELSE
    -- Quota exhausted: all sessions go to remaining, nothing inserted.
    v_new_remaining := p_sessions;

  END IF;

  -- 6. Atomically manage import_progress within this same transaction.
  --    Replaces the JS-level saveImportProgress call, closing the window where
  --    a crash between the RPC return and saveImportProgress would silently
  --    drop remaining sessions from the queue.
  IF jsonb_array_length(v_new_remaining) > 0 THEN
    INSERT INTO import_progress (
      psychologist_id, patient_id, file_name, file_ext,
      remaining_sessions_json, created_at, updated_at
    )
    VALUES (
      p_psychologist_id, p_patient_id,
      COALESCE(p_file_name, ''), COALESCE(p_file_ext, ''),
      v_new_remaining, NOW(), NOW()
    )
    ON CONFLICT (psychologist_id, patient_id)
    DO UPDATE SET
      remaining_sessions_json = EXCLUDED.remaining_sessions_json,
      file_name               = EXCLUDED.file_name,
      file_ext                = EXCLUDED.file_ext,
      updated_at              = NOW();
  ELSE
    -- All sessions fit in the quota — delete any stale progress row.
    DELETE FROM import_progress
     WHERE psychologist_id = p_psychologist_id
       AND patient_id      = p_patient_id;
  END IF;

  -- 7. For TXT imports that completed fully, mark historical_import_done atomically.
  --    Runs after sessions, import_progress, and usage_tracking are all committed in
  --    the same transaction — no crash window between RPC return and JS update.
  --    IS DISTINCT FROM true: no-op write when flag is already set (idempotent).
  --    No new locks: patients row is not locked by any other step in this function.
  IF p_file_ext = 'txt'
     AND v_new_remaining = '[]'::jsonb
  THEN
    UPDATE patients
       SET historical_import_done = true
     WHERE id                    = p_patient_id
       AND psychologist_id       = p_psychologist_id
       AND historical_import_done IS DISTINCT FROM true;
  END IF;

  RETURN jsonb_build_object(
    'imported_count',  v_imported,
    'remaining_count', jsonb_array_length(v_new_remaining),
    'can_continue',    jsonb_array_length(v_new_remaining) > 0
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- increment_ai_assist
--
-- Atomicamente incrementa ai_assist_count en 1 y retorna el nuevo valor.
-- Garantiza que la fila de usage existe antes de actualizar.
-- Llamado desde ai-assist/route.ts luego de un completion exitoso.
--
-- SECURITY INVOKER: called via supabaseAdmin (service role).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_ai_assist(
  p_psychologist_id UUID,
  p_month           TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  -- Garantizar que la fila de usage existe (idempotente).
  INSERT INTO usage_tracking (
    psychologist_id, month, sessions_count, audio_minutes, ai_assist_count, estimated_cost
  )
  VALUES (p_psychologist_id, p_month, 0, 0, 0, 0)
  ON CONFLICT (psychologist_id, month) DO NOTHING;

  -- Incremento atómico con RETURNING: la DB hace el +1, JS nunca computa el valor.
  UPDATE usage_tracking
     SET ai_assist_count = ai_assist_count + 1
   WHERE psychologist_id = p_psychologist_id
     AND month = p_month
  RETURNING ai_assist_count INTO v_new_count;

  RETURN v_new_count;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- audit_logs
--
-- Append-only security audit trail. Written exclusively via supabaseAdmin
-- (service role). RLS is enabled with no client policies, so authenticated
-- users cannot read, write, or delete rows via the PostgREST API.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID        NOT NULL,
  action     TEXT        NOT NULL,
  metadata   JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
-- No RLS policies → all client requests are denied. Service role bypasses RLS.

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_action
  ON audit_logs (user_id, action, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- estimated_cost column on usage_tracking
--
-- Tracks cumulative estimated OpenAI spend (USD) per psychologist per month.
-- Incremented atomically by check_and_add_cost; never written from JS.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE usage_tracking
  ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- check_and_add_cost
--
-- Atomically checks the monthly AI cost cap and adds the new cost if within
-- limits. Uses SELECT ... FOR UPDATE on the usage_tracking row to serialize
-- concurrent AI calls for the same psychologist, eliminating TOCTOU.
--
-- Returns TRUE  → request is within budget, cost has been charged.
-- Returns FALSE → monthly cap already reached, request must be blocked.
--
-- SECURITY INVOKER: called via supabaseAdmin (service role).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_and_add_cost(
  p_psychologist_id UUID,
  p_month           TEXT,
  p_cost_delta      NUMERIC,
  p_max_cost        NUMERIC DEFAULT 10.0
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_current_cost NUMERIC;
BEGIN
  -- Ensure row exists so the FOR UPDATE below always finds a row.
  INSERT INTO usage_tracking (
    psychologist_id, month, sessions_count, audio_minutes, ai_assist_count, estimated_cost
  )
  VALUES (p_psychologist_id, p_month, 0, 0, 0, 0)
  ON CONFLICT (psychologist_id, month) DO NOTHING;

  -- Acquire a row-level lock. Concurrent AI calls for the same psychologist
  -- will block here and execute serially.
  SELECT estimated_cost
    INTO v_current_cost
    FROM usage_tracking
   WHERE psychologist_id = p_psychologist_id AND month = p_month
     FOR UPDATE;

  -- Block if already at or over the monthly cap.
  IF v_current_cost >= p_max_cost THEN
    RETURN FALSE;
  END IF;

  -- Atomically add the cost (DB expression — no JS value in UPDATE).
  UPDATE usage_tracking
     SET estimated_cost = estimated_cost + p_cost_delta
   WHERE psychologist_id = p_psychologist_id AND month = p_month;

  RETURN TRUE;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- insert_session_within_limit
--
-- Atomically checks the monthly session limit and inserts the session in a
-- single transaction. Uses SELECT ... FOR UPDATE on subscription_limits to
-- serialize concurrent calls for the same psychologist, eliminating the
-- TOCTOU race condition that exists when the check and insert are done in
-- separate application-level queries.
--
-- Raises EXCEPTION 'SESSION_LIMIT_EXCEEDED' (SQLSTATE P0001) if the
-- monthly limit has been reached. The caller maps this to LimitExceededError.
--
-- SECURITY INVOKER: runs under the service role (via supabaseAdmin.rpc),
-- no elevated privileges needed.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION insert_session_within_limit(
  p_patient_id        UUID,
  p_psychologist_id   UUID,
  p_raw_text          TEXT,
  p_transcription     TEXT,
  p_ai_summary        TEXT,
  p_audio_duration    INTEGER,
  p_session_notes     JSONB,
  p_fee               NUMERIC,
  p_session_date      DATE
)
RETURNS sessions
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_limit   INTEGER;
  v_count   BIGINT;
  v_session sessions;
BEGIN
  -- Ensure a limits row exists so the FOR UPDATE below always locks a row.
  -- (getOrCreateLimits in the service layer does this too, but a race between
  -- a brand-new account's first two concurrent sessions could skip it.)
  INSERT INTO subscription_limits (
    psychologist_id,
    max_patients,
    max_sessions_per_month,
    max_audio_minutes,
    max_ai_assist_per_month
  )
  VALUES (p_psychologist_id, 30, 120, 600, 20)
  ON CONFLICT (psychologist_id) DO NOTHING;

  -- Acquire a row-level lock on this psychologist's limits row.
  -- Concurrent calls for the same psychologist will block here and execute
  -- serially. The lock is released automatically when the transaction ends.
  SELECT max_sessions_per_month
    INTO v_limit
    FROM subscription_limits
   WHERE psychologist_id = p_psychologist_id
     FOR UPDATE;

  -- Count sessions created this calendar month (UTC boundaries).
  SELECT COUNT(*)
    INTO v_count
    FROM sessions
   WHERE psychologist_id = p_psychologist_id
     AND created_at >= DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC')
     AND created_at <  DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 month';

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'SESSION_LIMIT_EXCEEDED'
      USING DETAIL = FORMAT('Límite mensual de %s sesiones alcanzado', v_limit),
            HINT   = v_limit::TEXT;
  END IF;

  INSERT INTO sessions (
    patient_id,
    psychologist_id,
    raw_text,
    transcription,
    ai_summary,
    audio_duration,
    session_notes,
    fee,
    session_date
  )
  VALUES (
    p_patient_id,
    p_psychologist_id,
    p_raw_text,
    p_transcription,
    p_ai_summary,
    p_audio_duration,
    p_session_notes,
    p_fee,
    p_session_date
  )
  RETURNING * INTO v_session;

  RETURN v_session;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Reload PostgREST schema cache
--
-- Ejecutar después de crear o modificar funciones para que supabase.rpc()
-- las encuentre de inmediato, sin necesidad de reiniciar el proyecto.
-- ─────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
