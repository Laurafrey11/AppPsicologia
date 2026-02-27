import OpenAI from "openai"
import type { AiSummary } from "@/lib/repositories/session.repository"

let _openai: OpenAI | null = null

/** Lazy singleton — only instantiated on first use to avoid build-time errors. */
function getOpenAI(): OpenAI {
  if (!_openai) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set")
    _openai = new OpenAI({ apiKey })
  }
  return _openai
}

/**
 * Transcribes an audio blob using OpenAI Whisper.
 * Returns the transcription text and the estimated audio duration in minutes.
 *
 * @param audioBlob  - Audio file downloaded from Supabase Storage
 * @param fileName   - Original filename with extension (e.g., 'session.webm')
 */
export async function transcribeAudio(
  audioBlob: Blob,
  fileName: string
): Promise<{ transcription: string; durationMinutes: number }> {
  const openai = getOpenAI()
  const file = new File([audioBlob], fileName, { type: audioBlob.type || "audio/webm" })

  const result = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    language: "es",
    response_format: "verbose_json", // includes duration
  })

  // Whisper verbose_json includes duration in seconds
  const durationMinutes = Math.ceil((result as any).duration ?? 0) / 60

  return {
    transcription: result.text,
    durationMinutes,
  }
}

/**
 * Generates a structured clinical summary from session text.
 *
 * Returns a typed AiSummary object with:
 *  - main_topic
 *  - dominant_emotions
 *  - conflicts
 *  - clinical_hypotheses (tentative — must not be used as diagnosis)
 *  - points_to_explore
 */
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
  "points_to_explore": ["array de puntos sugeridos para próximas sesiones"]
}`,
      },
      {
        role: "user",
        content: text.slice(0, 12000), // cap at ~12k chars to stay within token limits
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

/**
 * Generates a cumulative case summary by synthesizing all session summaries for a patient.
 * Called after each new session — replaces the previous case_summary.
 *
 * @param summaries - Array of AiSummary objects, ordered oldest-to-newest
 */
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
Incluye: patrones recurrentes, evolución emocional, conflictos persistentes e hipótesis clínicas consolidadas.
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
