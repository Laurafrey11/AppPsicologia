/**
 * Utility to parse patients.case_summary, which can be:
 *   1. JSON: { summary: string, monthly_rates: {...}, scores: [...] }  (app-generated)
 *   2. Plain Markdown text with score lines like "Puntaje de sentimiento: 3"  (n8n-generated)
 *   3. null / empty
 */

export interface GlobalScore {
  fecha: string
  animo: number
  ansiedad: number
  adherencia?: number
}

export interface ParsedCaseSummary {
  /** Full display text (Markdown or clinical prose) */
  summary: string
  /** Structured scores for the evolution chart */
  scores?: GlobalScore[]
  /** Monthly rate config preserved from JSON (lost if n8n overwrites with plain text) */
  monthly_rates?: Record<string, unknown>
  /** Aggregate sentiment score extracted from Markdown (0-10) */
  sentimiento?: number
  /** Aggregate anxiety score extracted from Markdown (0-10) */
  ansiedad?: number
}

/** Extract the first numeric value following one of the given label patterns */
function extractScore(text: string, labels: string[]): number | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const regex = new RegExp(`${escaped}[:\\s]+([0-9]+(?:[.,][0-9]+)?)`, "i")
    const match = text.match(regex)
    if (match) {
      const val = parseFloat(match[1].replace(",", "."))
      if (!isNaN(val)) return val
    }
  }
  return null
}

export function parseCaseSummary(raw: string | null): ParsedCaseSummary | null {
  if (!raw || !raw.trim()) return null

  // ── Try JSON first ──────────────────────────────────────────────
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>

    // Mid-processing state written by old process-history endpoint
    if (obj._processing) return null

    if (typeof obj.summary === "string" && obj.summary.trim()) {
      const summaryText = obj.summary
      return {
        summary: summaryText,
        monthly_rates: obj.monthly_rates as Record<string, unknown> | undefined,
        scores: Array.isArray(obj.scores) ? (obj.scores as GlobalScore[]) : undefined,
        sentimiento: extractScore(summaryText, ["puntaje de sentimiento", "sentimiento", "ánimo", "animo"]) ?? undefined,
        ansiedad: extractScore(summaryText, ["nivel de ansiedad", "ansiedad", "anxiety"]) ?? undefined,
      }
    }

    // JSON exists but no summary key — might be only monthly_rates, skip display
    return null
  } catch {
    // Not JSON — treat as plain Markdown from n8n
  }

  // ── Plain Markdown / text from n8n ───────────────────────────────
  const sentimiento = extractScore(raw, [
    "puntaje de sentimiento",
    "sentimiento predominante",
    "sentimiento",
    "ánimo",
    "animo",
  ])
  const ansiedad = extractScore(raw, [
    "nivel de ansiedad",
    "puntaje de ansiedad",
    "ansiedad",
  ])

  return {
    summary: raw,
    sentimiento: sentimiento ?? undefined,
    ansiedad: ansiedad ?? undefined,
  }
}
