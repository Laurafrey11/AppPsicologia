# Guía de Deploy — PsicoApp

## Plataforma: Vercel (gratis) + Supabase (gratis)

### Limitaciones importantes del plan gratuito

| Límite | Impacto |
|---|---|
| Vercel: **10s timeout** en funciones | Audios largos (+5 min) pueden fallar en transcripción |
| Supabase: **pausa tras 7 días sin uso** | Proyecto se pausa si no hay tráfico |
| Supabase Storage: **1GB** | ~10h de audio a 128kbps |
| Supabase DB: **500MB** | Suficiente para miles de sesiones |

**Workaround para el timeout**: El audio se envía directamente a Whisper (ephemeral — no se guarda en Storage). WebM/Opus a 4 minutos ≈ 1-3 MB, dentro del límite de 4.5 MB de Vercel. El timeout de 10s es suficiente para notas de voz cortas.

**Solución práctica para el MVP**: Usá la grabación para fragmentos cortos (notas de voz de 2-5 minutos), no sesiones completas.

---

## Paso 1 — Supabase

### 1.1 Crear proyecto

1. Ir a [supabase.com](https://supabase.com) → New project
2. Nombre: `psicoapp` (o similar)
3. Región: elegí la más cercana (South America si está disponible, sino US East)
4. Guardá la contraseña del proyecto

### 1.2 Obtener credenciales

Settings → API:
- `Project URL` → es tu `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_URL`
- `anon public` → es tu `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` → es tu `SUPABASE_SERVICE_ROLE_KEY` (**SECRETA — nunca compartir**)

### 1.3 Ejecutar SQL

En Supabase Dashboard → **SQL Editor** → **New query**:

**Primero**: ejecutar `supabase/schema.sql` completo.
**Segundo**: ejecutar `supabase/security.sql` completo.
**Tercero**: ejecutar `supabase/functions.sql` completo (RPCs atómicas de importación y límites).

### 1.4 Configurar Auth

Authentication → Providers → Email:
- Enable email signup: ✅
- Confirm email: ✅ (recomendado para producción)

Authentication → URL Configuration:
- Site URL: `https://TU-APP.vercel.app`
- Redirect URLs: `https://TU-APP.vercel.app/**`

---

## Paso 2 — Vercel

### 2.1 Conectar repositorio

1. Ir a [vercel.com](https://vercel.com) → Add New Project
2. Importar desde GitHub: `Laurafrey11/AppPsicologia`
3. Framework Preset: **Next.js** (detectado automáticamente)

### 2.2 Variables de entorno

En Vercel → Project Settings → Environment Variables, agregar:

| Variable | Dónde conseguirla |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public |
| `SUPABASE_URL` | Igual que NEXT_PUBLIC_SUPABASE_URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role |
| `OPENAI_API_KEY` | platform.openai.com → API Keys |

**Entornos**: marcar `Production`, `Preview` y `Development` para todas.

### 2.3 Deploy

Click en **Deploy**. El primer deploy tarda 2-3 minutos.

La URL de producción será `https://app-psicologia-xxx.vercel.app` o tu dominio custom.

---

## Paso 3 — Post-deploy

### 3.1 Actualizar Supabase Auth URLs

Authentication → URL Configuration:
- Reemplazar `TU-APP.vercel.app` con la URL real de tu deploy

### 3.2 Instalar `@tailwindcss/postcss` y `lucide-react`

Asegurarse de haber corrido localmente antes del commit:
```bash
npm install -D @tailwindcss/postcss
npm install lucide-react
```

Estos se incluyen en `package.json` y Vercel los instala automáticamente al deployar.

---

## Actualizaciones futuras

Cada push a `main` dispara un redeploy automático en Vercel. Para cambios de DB:
1. Ejecutar el SQL en Supabase manualmente
2. Hacer push del código

---

## Escalar a producción real (cuando sea necesario)

- **Vercel Pro** ($20/mes): timeout 60s, mejor para audio largo
- **Supabase Pro** ($25/mes): sin pausa, más storage, backups automáticos, Point-in-Time Recovery
- Para audios muy largos: implementar transcripción asincrónica con Supabase Edge Functions + webhooks
