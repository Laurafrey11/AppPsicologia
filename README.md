# PsicoApp — MVP SaaS para psicólogos clínicos

Aplicación web privada para gestión de consultorio. Registra pacientes, sesiones, notas clínicas, análisis IA, transcripción de audio e importación de historial. Construida con Next.js 14, Supabase y OpenAI.

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend / Backend | Next.js 14 (App Router, TypeScript) |
| Base de datos | Supabase (PostgreSQL + Auth + Storage) |
| IA | OpenAI Whisper (transcripción) + GPT-4o-mini (resúmenes) |
| Estilos | Tailwind CSS v4, Framer Motion |
| Tests | Vitest (40 tests) |
| Deploy | Vercel |

---

## Funcionalidades

### Pacientes
- Alta, edición, baja lógica y eliminación definitiva
- Exportación de expediente completo en HTML imprimible (Ley 25.326)
- Consentimiento informado de grabación con registro de fecha

### Sesiones
- Notas libres + estructura clínica guiada (motivo, humor, hipótesis, intervenciones, evolución, plan)
- Fecha real de sesión configurable (distinta de la fecha de carga)
- Honorario y toggle de pago/no pago con animación (Framer Motion)
- Búsqueda de sesiones por fecha, texto, temática o análisis IA
- **Grabación de audio**: transcripción automática con Whisper al soltar el micrófono

### IA embebida
- **Transcripción automática** al terminar la grabación (Whisper)
- **Resumen de sesión** (GPT-4o-mini): sentimiento, mecanismo de defensa, temática, pensamiento predominante, hipótesis clínicas, puntos a explorar
- **Resumen clínico acumulado** (`case_summary`): se recalcula automáticamente después de cada sesión
- **AI Assist en notas**: resumir, condensar y corregir ortografía antes de guardar

### Dashboard por paciente (PatientMetrics)
- Sentimiento, pensamiento, mecanismo de defensa y temática predominante con % de frecuencia
- Resumen clínico acumulado con animación TextScramble
- Adherencia a terapia (Alta / Regular / Baja): promedio de días entre sesiones + días desde última
- Hipótesis clínicas recurrentes (top 4 consolidadas entre todas las sesiones)
- Puntos a explorar recurrentes (top 4)

### Dashboard general (Estadísticas)
- Ingreso mensual real, sesiones del mes, horas trabajadas (duración configurable en localStorage)
- Pacientes activos e inactivos, tasa de inactividad, duración promedio de tratamiento
- **Alertas**: sesiones sin pagar >4 días y pacientes sin sesión >21 días

### Supervisión IA
- Análisis transversal de todos los pacientes: temáticas, sentimientos, mecanismos y pensamientos más frecuentes

### Importación de sesiones históricas
- Formatos: **CSV**, **XLSX**, **TXT** con columnas `fecha` y `texto`
- Fechas en formato `YYYY-MM-DD` o `DD/MM/YYYY`
- Preview de 5 filas antes de confirmar
- Genera análisis IA por sesión y recalcula el resumen acumulado
- Cap duro de **200 filas por importación** + validación de cuota mensual

### Agendamiento (Calendly / Cal.com)
- El psicólogo guarda su URL de agendamiento en `/dashboard/perfil`
- Aparece botón **"📅 Agendar"** en la vista de cada paciente si el link está configurado
- Sin integración de API — redirección simple a nueva pestaña

---

## Límites del Plan Base

| Recurso | Límite |
|---|---|
| Pacientes activos | 30 |
| Sesiones por mes | 120 |
| Minutos de audio por mes | 600 |

Los límites se validan **server-side antes de cada operación**. No se pueden saltar llamando directamente a los endpoints.

---

## Seguridad

- **Auth**: JWT de Supabase verificado en todos los endpoints (`getAuthUser`)
- **Sin trust del cliente**: `psychologist_id` siempre derivado del token, nunca del body
- **Aislamiento total**: todas las queries filtran por `psychologist_id`
- **Storage ownership**: paths de audio escopados por `user.id/` — se verifica antes de transcribir
- **RLS**: habilitado en todas las tablas (ver Migraciones SQL)
- **Sin SQL injection**: todo via Supabase SDK con parámetros
- **OpenAI solo server-side**: `OPENAI_API_KEY` nunca expuesta al cliente
- **Sin PII en logs**: los logs estructurados no incluyen datos de pacientes

---

## Variables de entorno

```env
# Supabase (públicas — van al cliente)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Supabase (privadas — solo server)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# OpenAI (privada — solo server)
OPENAI_API_KEY=
```

Configurarlas en **Vercel → Settings → Environment Variables**.

---

## Migraciones SQL (Supabase → SQL Editor)

### 1. session_date (si no existe)

```sql
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_date date;
```

### 2. Tabla profiles (link de agendamiento)

```sql
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  psychologist_id uuid REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  scheduling_link text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_own" ON profiles
  USING (auth.uid() = psychologist_id)
  WITH CHECK (auth.uid() = psychologist_id);
```

### 3. RLS en tablas principales

```sql
-- patients
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "patients_own" ON patients
  USING (auth.uid() = psychologist_id)
  WITH CHECK (auth.uid() = psychologist_id);

-- sessions
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sessions_own" ON sessions
  USING (auth.uid() = psychologist_id)
  WITH CHECK (auth.uid() = psychologist_id);

-- subscription_limits (solo lectura propia)
ALTER TABLE subscription_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "limits_read_own" ON subscription_limits
  FOR SELECT USING (auth.uid() = psychologist_id);
```

### 4. Storage policies (bucket session-audio — debe ser privado)

```sql
CREATE POLICY "upload_own_audio" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'session-audio'
    AND auth.uid()::text = split_part(name, '/', 1)
  );

CREATE POLICY "download_own_audio" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'session-audio'
    AND auth.uid()::text = split_part(name, '/', 1)
  );
```

---

## Flujo de audio (evita el límite de 4.5 MB de Vercel)

```
1. Cliente solicita URL firmada  →  GET /api/sessions/upload-url
2. Cliente sube audio directamente a Supabase Storage (PUT con URL firmada)
3. Al terminar, el modal llama →  GET /api/sessions/transcribe?path=...
4. Servidor verifica ownership del path (user.id prefix)
5. Servidor transcribe con Whisper + chequea límite de audio
6. Texto transcripto aparece en el textarea para edición
7. Al guardar →  POST /api/sessions (con storage_path ya subido)
8. Servidor genera resumen IA + recalcula case_summary
```

---

## Estructura del proyecto

```
src/
├── app/
│   ├── api/
│   │   ├── patients/
│   │   │   ├── route.ts               # GET lista, POST crear paciente
│   │   │   └── [id]/
│   │   │       ├── route.ts           # GET detalle+sesiones, PATCH, DELETE
│   │   │       ├── export/route.ts    # GET expediente HTML
│   │   │       └── import/route.ts    # POST importar sesiones (CSV/XLSX/TXT)
│   │   ├── sessions/
│   │   │   ├── route.ts               # POST crear sesión
│   │   │   ├── [id]/route.ts          # PATCH (toggle paid)
│   │   │   ├── upload-url/route.ts    # GET URL firmada para audio
│   │   │   ├── transcribe/route.ts    # GET transcribir audio (Whisper)
│   │   │   └── ai-assist/route.ts     # POST asistente IA de notas
│   │   ├── stats/route.ts             # GET estadísticas del consultorio
│   │   ├── supervision/route.ts       # GET análisis transversal IA
│   │   └── profile/route.ts           # GET/PATCH perfil (scheduling_link)
│   └── dashboard/
│       ├── layout.tsx
│       ├── page.tsx
│       ├── estadisticas/page.tsx
│       ├── supervision/page.tsx
│       ├── perfil/page.tsx
│       └── patients/[id]/page.tsx
├── components/
│   ├── Sidebar.tsx
│   ├── NewPatientModal.tsx
│   ├── NewSessionModal.tsx            # Grabación, transcripción, notas, AI Assist
│   ├── ImportSessionsModal.tsx        # Importación histórica
│   ├── SessionCard.tsx                # Tarjeta expandible con toggle de pago
│   ├── PatientMetrics.tsx             # Dashboard clínico por paciente
│   ├── ConsentRecordingModal.tsx
│   ├── ThemeToggle.tsx
│   └── ui/
│       ├── spotlight-card.tsx         # GlowCard — efecto de borde con cursor
│       ├── spotlight.tsx              # Spotlight interior con cursor
│       ├── animated-state-icons.tsx   # TogglePaid animado (Framer Motion)
│       ├── wave-text.tsx
│       ├── text-scramble.tsx
│       └── pixel-canvas.tsx
└── lib/
    ├── auth/get-user.ts               # Verificación JWT — usado en todas las rutas
    ├── services/
    │   ├── session.service.ts
    │   ├── patient.service.ts
    │   ├── limits.service.ts          # checkPatientLimit, checkSessionLimit, checkAudioLimit
    │   └── openai.service.ts          # transcribeAudio, generateSessionSummary, generateCaseSummary
    ├── repositories/
    │   ├── session.repository.ts
    │   ├── patient.repository.ts
    │   └── limits.repository.ts
    ├── validators/
    │   ├── session.schema.ts
    │   └── patient.schema.ts
    ├── errors/
    │   ├── BaseError.ts
    │   ├── DomainError.ts
    │   ├── LimitExceededError.ts
    │   └── UnauthorizedError.ts
    └── supabase-admin.ts              # Service role client (server-side only)
```

---

## Setup local

```bash
git clone https://github.com/Laurafrey11/AppPsicologia.git
cd AppPsicologia
npm install

# Crear .env.local con las variables de entorno (ver sección Variables de entorno)

npm run dev    # http://localhost:3000
npm test       # 40 tests unitarios
```

---

## Cumplimiento Ley 25.326 (Argentina)

- Datos accesibles solo al psicólogo propietario (RLS + psychologist_id en queries)
- Pacientes pueden ser dados de baja lógica (`is_active = false`) o eliminados definitivamente
- Exportación completa de expediente en HTML por paciente
- Consentimiento de grabación con registro de fecha
- OpenAI recibe texto sin nombre ni datos identificatorios del paciente
