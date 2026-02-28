import OpenAI from "openai"
import type { AiSummary } from "@/lib/repositories/session.repository"

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
  const result = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    language: "es",
    response_format: "verbose_json",
  })
  const durationMinutes = Math.ceil((result as unknown as { duration?: number }).duration ?? 0) / 60
  return { transcription: result.text, durationMinutes }
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
