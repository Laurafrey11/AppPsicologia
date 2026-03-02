import OpenAI from "openai"
import type { AiSummary } from "@/lib/repositories/session.repository"
import { logger } from "@/lib/logger/logger"

let _openai: OpenAI | null = null

function getOpenAI(): OpenAI {
  if (!_openai) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set")
    _openai = new OpenAI({ apiKey })
  }
  return _openai
}

export async function transcribeAudio(
  audioBlob: Blob,
  fileName: string
): Promise<{ transcription: string; durationMinutes: number }> {
  const openai = getOpenAI()
  const file = new File([audioBlob], fileName, { type: audioBlob.type || "audio/webm" })
  // "json" returns { text } immediately — no segment/duration metadata.
  // This minimises response payload and avoids unnecessary parsing overhead.
  // durationMinutes is not available in this format; audio quota checks use
  // the monthly cost cap instead, so returning 0 here is safe.
  const result = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    language: "es",
    response_format: "json",
  })
  return { transcription: result.text, durationMinutes: 0 }
}

export async function generateSessionSummary(text: string): Promise<AiSummary> {
  const openai = getOpenAI()
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Eres un asistente para psicólogos clínicos. Analiza el texto de una sesión y genera un resumen estructurado en JSON.
IMPORTANTE: Las hipótesis clínicas son tentativas y de apoyo al profesional, NO son diagnósticos.
Responde ÚNICAMENTE con JSON válido, sin texto adicional.

Formato requerido:
{
  "main_topic": "string — tema central de la sesión",
  "dominant_emotions": ["array de emociones identificadas"],
  "conflicts": ["array de conflictos o tensiones identificadas"],
  "clinical_hypotheses": ["array de hipótesis clínicas tentativas"],
  "points_to_explore": ["array de puntos sugeridos para próximas sesiones"],
  "sentimiento_predominante": "string — la emoción o sentimiento más predominante (ej: Tristeza, Ansiedad, Enojo, Culpa, Miedo, Vergüenza, Alegría, Ambivalencia)",
  "pensamiento_predominante": "string — el patrón de pensamiento más destacado (ej: Catastrofización, Pensamiento dicotómico, Sobregeneralización, Personalización, Minimización, Rumiación)",
  "mecanismo_defensa": "string — el mecanismo de defensa más evidente (ej: Proyección, Racionalización, Negación, Disociación, Sublimación, Represión, Desplazamiento, Intelectualización)",
  "tematica_predominante": "string — la temática central del caso (ej: Vínculos familiares, Autoestima, Duelo, Trauma, Identidad, Relaciones de pareja, Trabajo/rendimiento, Ansiedad social)"
}`,
      },
      {
        role: "user",
        content: text.slice(0, 12000),
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  })
  const content = response.choices[0]?.message?.content
  if (!content) throw new Error("OpenAI returned empty response for session summary")
  try {
    return JSON.parse(content) as AiSummary
  } catch {
    throw new Error("OpenAI returned invalid JSON for session summary")
  }
}

export async function extractSessionsFromText(
  text: string
): Promise<Array<{ fecha: string; texto: string }>> {
  const openai = getOpenAI()
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Extraé sesiones clínicas del texto. Reglas:
- Identificá fecha y texto de cada sesión.
- Devolvé como máximo 15 sesiones. Si hay más, priorizá las más recientes.
- Convertí cualquier fecha a formato YYYY-MM-DD.
- No inventés, no resumás, no analices — solo estructurá el texto tal como está.
- Respondé ÚNICAMENTE con este JSON, sin texto adicional:
{"sessions":[{"fecha":"YYYY-MM-DD","texto":"texto de la sesión"}]}`,
      },
      {
        role: "user",
        content: text,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  })
  const content = response.choices[0]?.message?.content
  if (!content) throw new Error("OpenAI no devolvió respuesta al extraer sesiones")
  const parsed = JSON.parse(content) as { sessions?: unknown }
  if (!Array.isArray(parsed.sessions)) {
    throw new Error("OpenAI devolvió un formato inesperado (falta array sessions)")
  }
  return (parsed.sessions as Array<unknown>).filter(
    (s): s is { fecha: string; texto: string } =>
      typeof s === "object" &&
      s !== null &&
      typeof (s as Record<string, unknown>).fecha === "string" &&
      typeof (s as Record<string, unknown>).texto === "string"
  )
}

/**
 * Batch-generates clinical summaries for an array of sessions.
 *
 * Makes ceil(N / CHUNK_SIZE) sequential calls instead of N individual ones.
 * Each call sends up to CHUNK_SIZE sessions and receives the same number of
 * summaries in the same order. On chunk failure the positions stay null so
 * the caller can still insert the session without a summary.
 *
 * Returns an array of length === sessions.length (AiSummary | null per item).
 */
export async function generateBatchSessionSummaries(
  sessions: Array<{ fecha: string; texto: string }>
): Promise<Array<AiSummary | null>> {
  if (sessions.length === 0) return []

  const openai = getOpenAI()
  const CHUNK_SIZE = 20
  const MAX_CHARS_PER_SESSION = 4000

  // Pre-fill with nulls so any chunk that fails leaves safe defaults
  const results: Array<AiSummary | null> = Array.from({ length: sessions.length }, () => null)

  for (let start = 0; start < sessions.length; start += CHUNK_SIZE) {
    const chunk = sessions.slice(start, start + CHUNK_SIZE)

    const input = chunk.map((s, i) => ({
      i,
      fecha: s.fecha,
      texto: s.texto.slice(0, MAX_CHARS_PER_SESSION),
    }))

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Sos un asistente para psicólogos clínicos.
Se te envía un array JSON de sesiones clínicas, cada una con campo "i" (índice), "fecha" y "texto".
Para cada sesión generá un resumen clínico estructurado.

Devolvé ÚNICAMENTE este JSON (sin texto adicional):
{
  "summaries": [
    {
      "main_topic": "tema central de la sesión",
      "dominant_emotions": ["array de emociones"],
      "conflicts": ["array de conflictos o tensiones"],
      "clinical_hypotheses": ["array de hipótesis clínicas tentativas (NO diagnósticos)"],
      "points_to_explore": ["array de puntos para próximas sesiones"],
      "sentimiento_predominante": "Tristeza | Ansiedad | Enojo | Culpa | Miedo | Vergüenza | Alegría | Ambivalencia",
      "pensamiento_predominante": "Catastrofización | Pensamiento dicotómico | Sobregeneralización | Personalización | Minimización | Rumiación",
      "mecanismo_defensa": "Proyección | Racionalización | Negación | Disociación | Sublimación | Represión | Desplazamiento | Intelectualización",
      "tematica_predominante": "Vínculos familiares | Autoestima | Duelo | Trauma | Identidad | Relaciones de pareja | Trabajo/rendimiento | Ansiedad social"
    }
  ]
}

Reglas estrictas:
- El array "summaries" debe tener EXACTAMENTE ${chunk.length} elementos en el MISMO ORDEN que la entrada.
- Si una sesión tiene texto insuficiente para analizar, devolvé null en esa posición.
- Respondé ÚNICAMENTE con JSON válido.`,
          },
          {
            role: "user",
            content: JSON.stringify(input),
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      })

      const content = response.choices[0]?.message?.content
      if (!content) {
        logger.error("generateBatchSessionSummaries: empty response", { start, chunkSize: chunk.length })
        continue
      }

      const parsed = JSON.parse(content) as { summaries?: unknown[] }
      if (!Array.isArray(parsed.summaries)) {
        logger.error("generateBatchSessionSummaries: malformed response (no summaries array)", { start })
        continue
      }

      for (let i = 0; i < chunk.length; i++) {
        const item: unknown = parsed.summaries[i]
        if (
          item !== null &&
          item !== undefined &&
          typeof item === "object" &&
          typeof (item as Record<string, unknown>).main_topic === "string"
        ) {
          results[start + i] = item as AiSummary
        }
        // else: remains null — session inserts without summary
      }
    } catch (err: unknown) {
      logger.error("generateBatchSessionSummaries chunk failed — sessions will import without summaries", {
        start,
        chunkSize: chunk.length,
        error: (err as Error).message,
      })
      // results[start..start+chunkSize-1] stay null; import continues
    }
  }

  return results
}

export async function generateCaseSummary(summaries: AiSummary[]): Promise<string> {
  if (summaries.length === 0) return ""
  const openai = getOpenAI()
  const summaryText = summaries
    .map((s, i) => `Sesión ${i + 1}:\n${JSON.stringify(s, null, 2)}`)
    .join("\n\n")
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Eres un asistente para psicólogos clínicos. Dado el historial de resúmenes de sesiones de un paciente,
genera un resumen clínico acumulativo en texto corrido (no JSON).
Incluye: patrones recurrentes, evolución emocional, mecanismos de defensa prevalentes, temáticas persistentes e hipótesis clínicas consolidadas.
Sé conciso (máximo 400 palabras). Usa lenguaje profesional. No incluyas diagnósticos.`,
      },
      {
        role: "user",
        content: summaryText.slice(0, 14000),
      },
    ],
    temperature: 0.3,
  })
  const content = response.choices[0]?.message?.content
  if (!content) throw new Error("OpenAI returned empty response for case summary")
  return content
}
