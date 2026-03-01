import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import {
  getOrCreateLimits,
  getOrCreateMonthUsage,
  incrementAiAssistCount,
} from "@/lib/repositories/limits.repository"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"
import OpenAI from "openai"

let _openai: OpenAI | null = null
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
  return _openai
}

const SYSTEM_PROMPTS: Record<string, string> = {
  summarize: `Eres un asistente clínico de apoyo para psicólogos.
Resumí el siguiente texto de notas de sesión en 3-5 oraciones claras, manteniendo los puntos clínicamente relevantes.
Respondé SOLO con el resumen, sin introducción ni cierre.`,

  condense: `Eres un asistente clínico de apoyo para psicólogos.
Condensá el siguiente texto de notas de sesión. Eliminá redundancias, manteniendo toda la información relevante.
El resultado debe ser más corto que el original pero sin perder datos clínicos importantes.
Respondé SOLO con el texto condensado, sin introducción ni cierre.`,

  grammar: `Eres un asistente de redacción clínica.
Corregí la ortografía y gramática del siguiente texto sin cambiar su significado ni agregar contenido.
Respondé SOLO con el texto corregido, sin introducción ni cierre.`,
}

/** Returns the current month as "YYYY-MM". */
function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

/**
 * POST /api/sessions/ai-assist
 *
 * Body: { text: string, action: "summarize" | "condense" | "grammar" }
 * Returns: { result: string }
 *
 * Rate-limited: reads ai_assist_count from usage_tracking BEFORE calling OpenAI.
 * After a successful call, increments the counter atomically via a DB expression
 * (SET ai_assist_count = ai_assist_count + 1) — never writes a JS-computed value.
 */
export async function POST(req: Request) {
  try {
    const user = await getAuthUser(req)
    const month = currentMonth()

    // Fetch plan limits + current month usage in parallel.
    const [limits, usage] = await Promise.all([
      getOrCreateLimits(user.id),
      getOrCreateMonthUsage(user.id, month),
    ])

    if (usage.ai_assist_count >= limits.max_ai_assist_per_month) {
      logger.warn("AI assist limit reached", {
        psychologistId: user.id,
        month,
        count: usage.ai_assist_count,
        limit: limits.max_ai_assist_per_month,
      })
      return NextResponse.json(
        {
          error: `Límite mensual de Asistente IA alcanzado (${limits.max_ai_assist_per_month} usos/mes). Se renueva el 1° de cada mes.`,
          code: "AI_ASSIST_LIMIT_EXCEEDED",
          used: usage.ai_assist_count,
          limit: limits.max_ai_assist_per_month,
        },
        { status: 403 }
      )
    }

    const body = await req.json()
    const { text, action } = body as { text: string; action: string }

    if (!text?.trim()) {
      return NextResponse.json({ error: "El texto no puede estar vacío" }, { status: 400 })
    }

    if (text.length > 20000) {
      return NextResponse.json({ error: "El texto es demasiado largo (máx. 20.000 caracteres)" }, { status: 400 })
    }

    const systemPrompt = SYSTEM_PROMPTS[action]
    if (!systemPrompt) {
      return NextResponse.json({ error: "Acción no válida" }, { status: 400 })
    }

    logger.info("AI assist requested", {
      action,
      textLength: text.length,
      psychologistId: user.id,
      usedThisMonth: usage.ai_assist_count,
    })

    const openai = getOpenAI()
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      max_tokens: 1000,
      temperature: 0.3,
    })

    const result = completion.choices[0]?.message?.content?.trim() ?? ""

    // Atomic increment: DB executes SET ai_assist_count = ai_assist_count + 1.
    // The JS value from usage.ai_assist_count is never used in this UPDATE.
    await incrementAiAssistCount(user.id, month)

    return NextResponse.json({ result })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("POST /api/sessions/ai-assist failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 })
  }
}
