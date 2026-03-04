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
  "tematica_predominante": "string — la temática central del caso (ej: Vínculos familiares, Autoestima, Duelo, Trauma, Identidad, Relaciones de pareja, Trabajo/rendimiento, Ansiedad social)",
  "has_risk": false,
  "tags": ["máximo 3 etiquetas clínicas cortas"],
  "resumen_narrativo": "Exactamente dos párrafos separados por salto de línea. Párrafo 1: temas clave tratados en la sesión. Párrafo 2: evolución clínica observada o cierre de la sesión. Sin introducción, sin saludo, sin encabezado."
}

Regla has_risk: ponelo true ÚNICAMENTE si el texto menciona explícitamente ideas autolíticas, riesgo de vida inminente o violencia grave. En todos los demás casos debe ser false.
Regla tags: generá entre 1 y 3 etiquetas descriptivas cortas (2-4 palabras cada una) que capturen los temas clave de la sesión.
Regla resumen_narrativo: EXACTAMENTE dos párrafos. El primero detalla los temas trabajados. El segundo describe la evolución o cierre. Sin introducciones ni saludos.`,
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
  // AbortSignal.timeout(8000): throws TimeoutError after 8s so the route can
  // return a controlled 504 instead of being killed by Vercel's 10s wall.
  const response = await openai.chat.completions.create(
    {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Extract sessions from this text. Output JSON only:\n{"sessions":[{"fecha":"YYYY-MM-DD","texto":"clinical notes"}]}\nMax 10 sessions. Process from most recent to oldest. Focus on clarity.`,
        },
        {
          role: "user",
          content: text,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 1500,
    },
    { signal: AbortSignal.timeout(8_000) }
  )
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
      "tematica_predominante": "Vínculos familiares | Autoestima | Duelo | Trauma | Identidad | Relaciones de pareja | Trabajo/rendimiento | Ansiedad social",
      "has_risk": false,
      "tags": ["máximo 3 etiquetas clínicas cortas"]
    }
  ]
}

Reglas estrictas:
- El array "summaries" debe tener EXACTAMENTE ${chunk.length} elementos en el MISMO ORDEN que la entrada.
- Si una sesión tiene texto insuficiente para analizar, devolvé null en esa posición.
- has_risk: true ÚNICAMENTE si hay ideas autolíticas, riesgo de vida inminente o violencia grave. En todos los demás casos false.
- tags: entre 1 y 3 etiquetas descriptivas cortas (2-4 palabras) que capturen los temas clave.
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

/**
 * Generates a clinical supervision report from all AI session summaries.
 * Used by the automatic supervision feature (every 5 sessions).
 */
export async function generateSupervisionReport(summaries: AiSummary[]): Promise<string> {
  if (summaries.length === 0) return ""
  const openai = getOpenAI()
  const summaryText = summaries
    .map((s, i) => `Sesión ${i + 1}: ${JSON.stringify(s)}`)
    .join("\n")
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Sos un colega clínico de confianza que da una segunda opinión sobre el proceso terapéutico. Dado el historial de análisis de sesiones de un paciente, generá una interconsulta clínica estructurada desde un lugar de colegiatura, no de evaluación.

La interconsulta debe incluir:
1. Patrones recurrentes detectados (temáticas, emociones, mecanismos de defensa prevalentes)
2. Evolución observada a lo largo del proceso
3. Hipótesis clínicas consolidadas (como segunda opinión, no como diagnóstico)
4. Puntos que podrían merecer atención o exploración adicional
5. Sugerencias técnicas para las próximas sesiones, desde un tono colaborativo

Usá lenguaje profesional y clínico, como si hablaras con un colega de confianza. No incluyas diagnósticos. Máximo 4 párrafos.`,
      },
      {
        role: "user",
        content: summaryText.slice(0, 12000),
      },
    ],
    temperature: 0.3,
  })
  const content = response.choices[0]?.message?.content
  if (!content) throw new Error("OpenAI returned empty response for supervision report")
  return content
}

/**
 * Generates an interconsulta (second opinion) report from the last N sessions.
 * Works with sessions that may or may not have individual AI summaries.
 * For sessions without summaries, uses raw_text directly as clinical context.
 */
export async function generateInterConsultaReport(
  sessions: Array<{
    date: string
    raw_text: string | null
    ai_summary: AiSummary | null
  }>
): Promise<string> {
  if (sessions.length === 0) return ""
  const openai = getOpenAI()

  const MAX_RAW_CHARS = 2000
  const context = sessions
    .map((s, i) => {
      const label = `Sesión ${i + 1} (${s.date})`
      if (s.ai_summary && s.ai_summary.main_topic) {
        return `${label} [analizada]:\n${JSON.stringify(s.ai_summary)}`
      }
      const text = (s.raw_text ?? "").slice(0, MAX_RAW_CHARS)
      return `${label} [notas]:\n${text}`
    })
    .join("\n\n")

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Sos un colega clínico de confianza que da una segunda opinión sobre el proceso terapéutico. Basándote en el historial de sesiones que se te provee (algunas ya analizadas, otras en texto libre), generá una interconsulta clínica estructurada desde un lugar de colegiatura, no de evaluación.

La interconsulta debe incluir:
1. Patrones recurrentes detectados (temáticas, emociones, mecanismos de defensa prevalentes)
2. Evolución observada a lo largo del proceso
3. Hipótesis clínicas consolidadas (como segunda opinión, no como diagnóstico)
4. Puntos que podrían merecer atención o exploración adicional
5. Sugerencias técnicas para las próximas sesiones, desde un tono colaborativo

Usá lenguaje profesional y clínico, como si hablaras con un colega de confianza. No incluyas diagnósticos. Máximo 4 párrafos.`,
      },
      {
        role: "user",
        content: context.slice(0, 12000),
      },
    ],
    temperature: 0.3,
  })
  const content = response.choices[0]?.message?.content
  if (!content) throw new Error("OpenAI returned empty response for interconsulta report")
  return content
}

export type CaseAnalysis = {
  summary: string
  has_risk: boolean
  tags: string[]
  clinical_advice: string
  scores: Array<{ fecha: string; animo: number; ansiedad: number }>
}

/**
 * Transversal case analysis using a master clinical supervisor prompt.
 * Receives all sessions (with raw text) and returns a structured JSON analysis.
 * Used by the "Procesar historial con IA" on-demand button.
 */
export async function generateCaseAnalysis(
  sessions: Array<{ fecha: string; texto: string }>
): Promise<CaseAnalysis> {
  if (sessions.length === 0) {
    return { summary: "", has_risk: false, tags: [], clinical_advice: "", scores: [] }
  }
  const openai = getOpenAI()

  const MAX_CHARS_PER_SESSION = 1500
  const context = sessions
    .map((s, i) => `Sesión ${i + 1} (${s.fecha}):\n${s.texto.slice(0, MAX_CHARS_PER_SESSION)}`)
    .join("\n\n")

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Actuás como un supervisor clínico experto con 20 años de experiencia. Se te proporcionará un listado de sesiones de un paciente (fecha y contenido bruto).

Tu tarea es:
1. Realizar una lectura transversal de todo el historial.
2. Identificar patrones de comportamiento y evolución de síntomas.
3. Detectar indicadores de riesgo (has_risk: true ÚNICAMENTE si hay ideas autolíticas, riesgo de vida inminente o violencia grave; en todos los demás casos false).
4. Generar 3-5 etiquetas técnicas (tags) que resuman la problemática principal (ej: #Duelo, #Transferencia, #AnsiedadSocial).
5. Redactar un informe de interconsulta en tono de colega, breve (máximo 3 párrafos), destacando avances y puntos ciegos para el terapeuta.

Respondé ÚNICAMENTE con JSON válido, sin texto adicional:
{
  "summary": "Dos párrafos: evolución clínica y temas recurrentes",
  "has_risk": false,
  "tags": ["Tag1", "Tag2"],
  "clinical_advice": "Un párrafo de sugerencia para el terapeuta desde perspectiva de colega",
  "scores": [
    { "fecha": "YYYY-MM-DD", "animo": 7, "ansiedad": 4 }
  ]
}

Regla scores: Para CADA sesión incluida en el input, generá un objeto con:
- "fecha": la fecha de esa sesión (igual a la que viene en el input)
- "animo": número del 1 al 10 (1 = ánimo muy bajo, 10 = ánimo muy alto) basado en el contenido clínico de esa sesión
- "ansiedad": número del 1 al 10 (1 = sin ansiedad, 10 = ansiedad extrema) basado en el contenido de esa sesión
El array "scores" debe tener exactamente un elemento por cada sesión del input, en el mismo orden.`,
      },
      {
        role: "user",
        content: context.slice(0, 14000),
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  })

  const content = response.choices[0]?.message?.content
  if (!content) throw new Error("OpenAI returned empty response for case analysis")
  try {
    return JSON.parse(content) as CaseAnalysis
  } catch {
    throw new Error("OpenAI returned invalid JSON for case analysis")
  }
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
Máximo 3 párrafos. Usa lenguaje profesional. No incluyas diagnósticos.`,
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
