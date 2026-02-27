-- =============================================================
-- PsicoApp — Supabase Schema
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query
-- =============================================================

-- ------------------------------------------------------------
-- 1. TABLAS
-- ------------------------------------------------------------

-- Pacientes de cada psicólogo
CREATE TABLE IF NOT EXISTS patients (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  psychologist_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  age              int  NOT NULL CHECK (age BETWEEN 1 AND 120),
  reason           text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 1000),
  case_summary     text,          -- resumen clínico acumulado (generado por IA)
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Sesiones clínicas
CREATE TABLE IF NOT EXISTS sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  psychologist_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  raw_text         text,           -- notas manuales del psicólogo
  transcription    text,           -- transcripción de audio (Whisper)
  ai_summary       text,           -- JSON: AiSummary (ver session.repository.ts)
  audio_duration   int,            -- duración en minutos del audio (redondeado)
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Límites del plan por psicólogo
CREATE TABLE IF NOT EXISTS subscription_limits (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  psychologist_id         uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  max_patients            int NOT NULL DEFAULT 30,
  max_sessions_per_month  int NOT NULL DEFAULT 120,
  max_audio_minutes       int NOT NULL DEFAULT 600,
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- Tracking de uso mensual (mes en formato YYYY-MM)
CREATE TABLE IF NOT EXISTS usage_tracking (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  psychologist_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month            char(7) NOT NULL,  -- 'YYYY-MM'
  sessions_count   int NOT NULL DEFAULT 0,
  audio_minutes    int NOT NULL DEFAULT 0,
  UNIQUE (psychologist_id, month)
);


-- ------------------------------------------------------------
-- 2. ÍNDICES DE PERFORMANCE
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_patients_psychologist_active
  ON patients (psychologist_id, is_active);

CREATE INDEX IF NOT EXISTS idx_sessions_patient
  ON sessions (patient_id, psychologist_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_psychologist_month
  ON sessions (psychologist_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_tracking_psych_month
  ON usage_tracking (psychologist_id, month);


-- ------------------------------------------------------------
-- 3. ROW LEVEL SECURITY (RLS)
-- NOTA: el servidor usa la service role key (supabaseAdmin) que
-- bypassa RLS. Las políticas son una capa de defensa adicional
-- para conexiones directas o futuras integraciones.
-- ------------------------------------------------------------

ALTER TABLE patients           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_tracking     ENABLE ROW LEVEL SECURITY;

-- patients
CREATE POLICY "psicólogo ve sus pacientes"
  ON patients FOR SELECT
  USING (auth.uid() = psychologist_id);

CREATE POLICY "psicólogo inserta sus pacientes"
  ON patients FOR INSERT
  WITH CHECK (auth.uid() = psychologist_id);

CREATE POLICY "psicólogo actualiza sus pacientes"
  ON patients FOR UPDATE
  USING (auth.uid() = psychologist_id)
  WITH CHECK (auth.uid() = psychologist_id);

CREATE POLICY "psicólogo elimina sus pacientes"
  ON patients FOR DELETE
  USING (auth.uid() = psychologist_id);

-- sessions
CREATE POLICY "psicólogo ve sus sesiones"
  ON sessions FOR SELECT
  USING (auth.uid() = psychologist_id);

CREATE POLICY "psicólogo inserta sus sesiones"
  ON sessions FOR INSERT
  WITH CHECK (auth.uid() = psychologist_id);

CREATE POLICY "psicólogo actualiza sus sesiones"
  ON sessions FOR UPDATE
  USING (auth.uid() = psychologist_id);

CREATE POLICY "psicólogo elimina sus sesiones"
  ON sessions FOR DELETE
  USING (auth.uid() = psychologist_id);

-- subscription_limits
CREATE POLICY "psicólogo ve sus límites"
  ON subscription_limits FOR SELECT
  USING (auth.uid() = psychologist_id);

-- usage_tracking
CREATE POLICY "psicólogo ve su uso"
  ON usage_tracking FOR SELECT
  USING (auth.uid() = psychologist_id);


-- ------------------------------------------------------------
-- 4. FUNCIÓN RPC: increment_usage
-- Incremento atómico para evitar race conditions cuando se
-- crean sesiones concurrentes (aunque es improbable en un SaaS
-- de uso individual, es buena práctica).
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION increment_usage(
  p_psychologist_id   uuid,
  p_month             char(7),
  p_sessions_delta    int,
  p_audio_minutes_delta int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER  -- se ejecuta con permisos del propietario (no del caller)
AS $$
BEGIN
  UPDATE usage_tracking
  SET
    sessions_count = sessions_count + p_sessions_delta,
    audio_minutes  = audio_minutes  + p_audio_minutes_delta
  WHERE
    psychologist_id = p_psychologist_id
    AND month = p_month;

  -- Si no existe la fila (poco probable porque getOrCreateMonthlyUsage
  -- la crea primero), insertarla para evitar un error silencioso.
  IF NOT FOUND THEN
    INSERT INTO usage_tracking (psychologist_id, month, sessions_count, audio_minutes)
    VALUES (p_psychologist_id, p_month, p_sessions_delta, p_audio_minutes_delta)
    ON CONFLICT (psychologist_id, month)
    DO UPDATE SET
      sessions_count = usage_tracking.sessions_count + EXCLUDED.sessions_count,
      audio_minutes  = usage_tracking.audio_minutes  + EXCLUDED.audio_minutes;
  END IF;
END;
$$;
