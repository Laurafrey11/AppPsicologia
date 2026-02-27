import { z } from "zod"

export const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email()
})

export type CreateUserInput = z.infer<typeof createUserSchema>
