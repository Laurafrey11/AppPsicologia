import { z } from "zod"

export const createPatientSchema = z.object({
  name: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100),
  age: z.number().int().min(1).max(120),
  reason: z.string().min(5, "La razón de consulta debe tener al menos 5 caracteres").max(1000),
})

export const updatePatientSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  age: z.number().int().min(1).max(120).optional(),
  reason: z.string().min(5).max(1000).optional(),
  is_active: z.boolean().optional(),
})

export type CreatePatientInput = z.infer<typeof createPatientSchema>
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>
