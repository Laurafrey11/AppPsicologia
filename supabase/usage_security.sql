-- =============================================================================
-- supabase/usage_security.sql
-- Seguridad, columnas faltantes y auditoría de usage_tracking
--
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query
-- Idempotente: ADD COLUMN IF NOT EXISTS, DROP IF EXISTS + CREATE, CREATE OR REPLACE
-- Ejecutar DESPUÉS de schema.sql y functions.sql
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Columnas faltantes en usage_tracking
--
-- schema.sql define la tabla con (sessions_count, audio_minutes) solamente.
-- El código TypeScript y functions.sql referencian ai_assist_count,
-- estimated_cost y updated_at — estas columnas deben existir.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE usage_tracking
  ADD COLUMN IF NOT EXISTS ai_assist_count INTEGER  NOT NULL DEFAULT 0;

ALTER TABLE usage_tracking
  ADD COLUMN IF NOT EXISTS estimated_cost  NUMERIC  NOT NULL DEFAULT 0;

ALTER TABLE usage_tracking
  ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Columna faltante en subscription_limits
--
-- El código TypeScript lee max_ai_assist_per_month de subscription_limits.
-- schema.sql no la incluye; se agrega aquí de forma idempotente.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE subscription_limits
  ADD COLUMN IF NOT EXISTS max_ai_assist_per_month INTEGER NOT NULL DEFAULT 20;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS — ya habilitado en schema.sql, idempotente repetirlo
--
-- Verifica que esté activo. Si schema.sql ya fue ejecutado, este comando
-- es un no-op seguro.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Políticas de acceso en usage_tracking
--
-- Patrón: DROP IF EXISTS + CREATE (PostgreSQL no soporta CREATE POLICY
-- IF NOT EXISTS de forma estándar — DROP + CREATE es la forma idempotente).
--
-- Regla de seguridad:
--   SELECT → psicólogo ve únicamente sus propias filas (auth.uid() = psychologist_id)
--   INSERT / UPDATE / DELETE → sin política = DENY implícito para roles
--   authenticated y anon. Solo service_role puede escribir (bypasea RLS).
--   Las funciones SECURITY INVOKER se ejecutan bajo el rol del llamador
--   (supabaseAdmin = service_role) → también bypasean RLS.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "psicólogo ve su uso" ON usage_tracking;
CREATE POLICY "psicólogo ve su uso"
  ON usage_tracking FOR SELECT
  USING (auth.uid() = psychologist_id);

-- No hay políticas INSERT / UPDATE / DELETE para authenticated/anon.
-- Con RLS activo, la ausencia de política equivale a denegación total.
-- Toda escritura va por supabaseAdmin (service_role) que bypasea RLS.


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Trigger: updated_at automático en usage_tracking
--
-- Registra cuándo fue la última vez que se actualizó el costo o el uso
-- de un psicólogo. Útil para auditoría operacional y debugging.
-- No reemplaza a audit_logs (que registra eventos de negocio como
-- AI_COST_CAP_EXCEEDED) — es una capa complementaria más ligera.
--
-- La función set_updated_at es genérica y puede reutilizarse en otras
-- tablas que necesiten este comportamiento.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS usage_tracking_set_updated_at ON usage_tracking;
CREATE TRIGGER usage_tracking_set_updated_at
  BEFORE UPDATE ON usage_tracking
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Verificación (ejecutar por separado para confirmar el estado)
--
-- Copiar y ejecutar en SQL Editor para ver el estado actual:
--
--   -- Ver RLS habilitado por tabla:
--   SELECT tablename, rowsecurity
--     FROM pg_tables
--    WHERE schemaname = 'public'
--      AND tablename IN ('usage_tracking', 'subscription_limits', 'patients', 'sessions');
--
--   -- Ver todas las políticas activas en usage_tracking:
--   SELECT policyname, cmd, qual
--     FROM pg_policies
--    WHERE tablename = 'usage_tracking';
--
--   -- Ver columnas de usage_tracking:
--   SELECT column_name, data_type, column_default, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'usage_tracking'
--    ORDER BY ordinal_position;
-- ─────────────────────────────────────────────────────────────────────────────


-- Recargar schema cache de PostgREST para que los cambios sean visibles
-- inmediatamente vía supabase.rpc() y supabase.from() sin reiniciar.
NOTIFY pgrst, 'reload schema';
