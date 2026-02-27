# PsicoApp

SaaS MVP de gestión clínica para psicólogos individuales. Permite registrar pacientes, cargar sesiones con notas manuales o audio, y generar resúmenes clínicos automáticos con IA.

## Stack

- **Frontend/Backend**: Next.js 14 (App Router, TypeScript)
- **Base de datos y auth**: Supabase (PostgreSQL + Auth + Storage)
- **IA**: OpenAI Whisper (transcripción) + GPT-4o-mini (resúmenes)
- **Estilos**: Tailwind CSS v4
- **Tests**: Vitest
- **Deploy**: Vercel

## Funcionalidades

- Auth con email/password (Supabase)
- Dashboard con lista de pacientes (sidebar)
- Pacientes: nombre, edad, motivo de consulta, resumen clínico acumulado
- Sesiones: notas manuales + grabación de audio + transcripción Whisper + resumen IA estructurado
- **Asistencia IA en notas**: resumir, condensar, corregir ortografía con aceptación/edición antes de guardar
- **Límites del plan**: max 30 pacientes activos, 120 sesiones/mes, 600 min de audio/mes
- Dark mode con persistencia en localStorage
- Efecto pixel shimmer en CTAs

## Arquitectura

```
src/
├── app/
│   ├── api/
│   │   ├── patients/           # GET (list), POST (create), [id] GET+PATCH
│   │   └── sessions/
│   │       ├── route.ts        # POST (create session)
│   │       ├── upload-url/     # GET (signed Storage URL for audio)
│   │       └── ai-assist/      # POST (summarize/condense notes)
│   ├── dashboard/
│   │   ├── layout.tsx          # Sidebar layout
│   │   └── patients/[id]/      # Patient detail view
│   └── login/                  # Auth page
├── components/
│   ├── ui/
│   │   ├── pixel-canvas.tsx    # Shimmer effect (Web Component wrapper)
│   │   └── ai-voice-input.tsx  # Microphone recorder with visualizer
│   ├── hooks/
│   │   └── use-auto-resize-textarea.ts
│   ├── Sidebar.tsx
│   ├── NewSessionModal.tsx     # Notes + AI assist + audio recorder
│   ├── NewPatientModal.tsx
│   ├── SessionCard.tsx
│   └── ThemeToggle.tsx
└── lib/
    ├── auth/get-user.ts        # Bearer token validation
    ├── errors/                 # BaseError, DomainError, UnauthorizedError, LimitExceededError
    ├── repositories/           # patient, session, limits (DB layer)
    ├── services/               # patient, session, limits, openai (business logic)
    ├── supabase/               # server.ts (SSR), client.ts (browser)
    └── validators/             # Zod schemas
```

### Flujo de audio (evita el límite de 4.5MB de Vercel)
1. Cliente solicita URL firmada → `GET /api/sessions/upload-url`
2. Cliente sube audio directamente a Supabase Storage (PUT con URL firmada)
3. Cliente envía solo el `storage_path` → `POST /api/sessions`
4. Servidor descarga audio del Storage con service role key
5. Servidor transcribe con Whisper y genera resumen con GPT-4o-mini

## Setup local

### 1. Clonar e instalar

```bash
git clone https://github.com/Laurafrey11/AppPsicologia.git
cd AppPsicologia
npm install
npm install -D @tailwindcss/postcss
npm install lucide-react
```

### 2. Variables de entorno

```bash
cp .env.local.example .env.local
# Completar con tus credenciales (ver .env.local.example)
```

### 3. Base de datos Supabase

Ejecutar en Supabase Dashboard → SQL Editor:
1. `supabase/schema.sql` — tablas, RLS, función RPC
2. `supabase/security.sql` — audit log, políticas extra de seguridad

Crear bucket de Storage:
- Nombre: `session-audio`
- Tipo: **privado** (sin acceso público)

### 4. Correr en desarrollo

```bash
npm run dev
```

## Tests

```bash
npm test
```

## Deploy

Ver [`DEPLOYMENT.md`](./DEPLOYMENT.md) para instrucciones completas.

## Seguridad

- **Datos en reposo**: AES-256 (Supabase managed)
- **Datos en tránsito**: TLS 1.3 (Vercel + Supabase)
- **Auth**: JWT verificado en cada request del servidor
- **RLS**: Cada psicólogo solo ve sus propios datos
- **Audio**: Bucket privado, accesible solo con service role key
- **OpenAI**: API key solo en servidor, nunca expuesta al browser
- **Audit log**: Registro de accesos a datos sensibles
- **Sin PII en logs**: Los logs estructurados no incluyen datos de pacientes

## Cumplimiento Ley 25.326 (Argentina)

- Los datos son accesibles solo al psicólogo propietario (RLS)
- Los pacientes pueden ser dados de baja (is_active = false)
- No se comparten datos con terceros (OpenAI recibe texto, no nombre/identidad)
- Posibilidad de exportar/eliminar datos por paciente
