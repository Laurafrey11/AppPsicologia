-- =============================================================
-- PsicoApp — Seguridad adicional para datos de salud mental
-- Ejecutar DESPUÉS de schema.sql
-- =============================================================

-- ------------------------------------------------------------
-- 1. EXTENSIONES DE SEGURIDAD
-- ------------------------------------------------------------

-- pgcrypto: para funciones de hashing y encriptación
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- pg_stat_statements: para auditar queries lentas o inusuales
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;


-- ------------------------------------------------------------
-- 2. TABLA DE AUDIT LOG
-- Registra quién accedió/modificó datos sensibles.
-- Permite detectar accesos no autorizados y cumplir con Ley 25.326.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  psychologist_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action           text NOT NULL,         -- 'create_patient', 'view_session', etc.
  resource_type    text NOT NULL,         -- 'patient' | 'session'
  resource_id      uuid,
  metadata         jsonb,                 -- info adicional (sin PII)
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Solo el psicólogo propietario puede ver sus propios logs
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "psicólogo ve sus propios logs"
  ON audit_log FOR SELECT
  USING (auth.uid() = psychologist_id);

-- El servicio inserta logs (via service role), no el cliente
-- No hay política INSERT para el rol anon/autenticado → solo service_role puede insertar

CREATE INDEX IF NOT EXISTS idx_audit_log_psych_date
  ON audit_log (psychologist_id, created_at DESC);


-- ------------------------------------------------------------
-- 3. PROTECCIÓN ADICIONAL EN TABLAS EXISTENTES
-- ------------------------------------------------------------

-- Evitar que psychologist_id se actualice después de la creación
-- (un psicólogo no puede reasignar un paciente a otro psicólogo)
CREATE OR REPLACE FUNCTION prevent_psychologist_id_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.psychologist_id IS DISTINCT FROM NEW.psychologist_id THEN
    RAISE EXCEPTION 'No se puede cambiar el psychologist_id de un registro existente';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER patients_prevent_psychologist_change
  BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION prevent_psychologist_id_change();

CREATE OR REPLACE TRIGGER sessions_prevent_psychologist_change
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION prevent_psychologist_id_change();


-- ------------------------------------------------------------
-- 4. FUNCIÓN PARA ELIMINAR DATOS DE UN PACIENTE
-- Cumplimiento del derecho al olvido (Ley 25.326 Art. 6 y 17).
-- Elimina todos los datos sensibles de un paciente, incluyendo audio.
-- Llamar desde el servidor con service_role.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION delete_patient_data(
  p_patient_id      uuid,
  p_psychologist_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verificar ownership antes de eliminar
  IF NOT EXISTS (
    SELECT 1 FROM patients
    WHERE id = p_patient_id AND psychologist_id = p_psychologist_id
  ) THEN
    RAISE EXCEPTION 'Paciente no encontrado o no pertenece a este psicólogo';
  END IF;

  -- Borrar sesiones (cascadea desde FK, pero explícito por claridad)
  DELETE FROM sessions
  WHERE patient_id = p_patient_id AND psychologist_id = p_psychologist_id;

  -- Borrar paciente
  DELETE FROM patients
  WHERE id = p_patient_id AND psychologist_id = p_psychologist_id;

  -- Nota: los archivos de audio en Storage deben eliminarse desde la aplicación
  -- usando supabaseAdmin.storage.from('session-audio').remove([...paths])
  -- ya que SQL no tiene acceso directo al Storage de Supabase.
END;
$$;


-- ------------------------------------------------------------
-- 5. FUNCIÓN PARA ELIMINAR TODOS LOS DATOS DE UN PSICÓLOGO
-- Derecho al olvido completo. Borra todo y la cuenta.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION delete_psychologist_data(
  p_psychologist_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Eliminar en orden correcto (FK constraints)
  DELETE FROM audit_log WHERE psychologist_id = p_psychologist_id;
  DELETE FROM usage_tracking WHERE psychologist_id = p_psychologist_id;
  DELETE FROM subscription_limits WHERE psychologist_id = p_psychologist_id;
  DELETE FROM sessions WHERE psychologist_id = p_psychologist_id;
  DELETE FROM patients WHERE psychologist_id = p_psychologist_id;
  -- Nota: eliminar al usuario de auth.users debe hacerse desde el servidor
  -- con supabaseAdmin.auth.admin.deleteUser(p_psychologist_id)
END;
$$;


-- ------------------------------------------------------------
-- 6. RESTRICCIONES ADICIONALES DE DATOS
-- ------------------------------------------------------------

-- Asegurar que sessions siempre pertenezcan a un paciente del mismo psicólogo
CREATE OR REPLACE FUNCTION validate_session_patient_ownership()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM patients
    WHERE id = NEW.patient_id AND psychologist_id = NEW.psychologist_id
  ) THEN
    RAISE EXCEPTION 'El paciente no pertenece a este psicólogo';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER sessions_validate_patient_ownership
  BEFORE INSERT ON sessions
  FOR EACH ROW EXECUTE FUNCTION validate_session_patient_ownership();


-- ------------------------------------------------------------
-- 7. VISTAS SEGURAS (sin datos ultra-sensibles para consultas de lista)
-- Usar en contextos donde no se necesitan las notas completas.
-- ------------------------------------------------------------

CREATE OR REPLACE VIEW patient_summary AS
SELECT
  id,
  psychologist_id,
  name,
  age,
  is_active,
  created_at,
  -- Omite reason y case_summary en esta vista de resumen
  CASE WHEN case_summary IS NOT NULL THEN true ELSE false END AS has_summary
FROM patients;

-- RLS aplica a views en Supabase, así que hereda las políticas de patients
ALTER VIEW patient_summary SET (security_invoker = true);


-- ------------------------------------------------------------
-- 8. CONFIGURACIÓN DE SEGURIDAD RECOMENDADA EN SUPABASE DASHBOARD
-- (No se puede hacer por SQL, son configuraciones de la plataforma)
-- ------------------------------------------------------------

-- ✅ Hacer manualmente en Supabase Dashboard:
--
-- Authentication → Settings:
--   - Enable email confirmations: YES
--   - Minimum password length: 8
--   - Enable "Leaked password protection": YES (HaveIBeenPwned integration)
--
-- Project Settings → Auth → JWT expiry: 3600 (1 hora)
--
-- API → Expose schemas: NO exponer schemas sensibles extra
--
-- Database → SSL enforcement: ON (ya viene por defecto en Supabase)


-- ------------------------------------------------------------
-- 9. ÍNDICES DE SEGURIDAD (para detectar anomalías de performance)
-- ------------------------------------------------------------

-- Búsquedas por fecha en audit_log para revisiones de seguridad
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON audit_log (created_at DESC);

-- Búsquedas de sesiones por psicólogo y fecha (para reportes)
CREATE INDEX IF NOT EXISTS idx_sessions_psychologist_created
  ON sessions (psychologist_id, created_at DESC);
