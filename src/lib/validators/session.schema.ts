import { z } from "zod"

const sessionNotesSchema = z.object({
  motivo_consulta: z.string().max(2000).optional().default(""),
  hipotesis_clinica: z.string().max(2000).optional().default(""),
  intervenciones: z.string().max(2000).optional().default(""),
  evolucion: z.string().max(2000).optional().default(""),
  plan_proximo: z.string().max(2000).optional().default(""),
})

export const createSessionSchema = z.object({
  patient_id: z.string().uuid("patient_id debe ser un UUID válido"),
  raw_text: z.string().max(20000).optional().default(""),
  audio_path: z.string().max(500).optional(),
  session_notes: sessionNotesSchema.optional(),
  fee: z.number().min(0).max(1000000).optional().nullable(),
})

export type CreateSessionInput = z.infer<typeof createSessionSchema>
export type SessionNotesInput = z.infer<typeof sessionNotesSchema>
