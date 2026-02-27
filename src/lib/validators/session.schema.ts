import { z } from "zod"

export const createSessionSchema = z.object({
  patient_id: z.string().uuid("patient_id debe ser un UUID válido"),
  raw_text: z.string().max(20000).optional().default(""),
  audio_path: z.string().max(500).optional(), // Supabase Storage path, if audio was uploaded
})

export type CreateSessionInput = z.infer<typeof createSessionSchema>
