import { CreateUserInput } from "../validators/user.schema"
import { insertUser } from "../repositories/user.repository"
import { DomainError } from "../errors/DomainError"
import { logger } from "../logger/logger"

export async function createUser(input: CreateUserInput) {
  logger.info("Creating user", { email: input.email })

  if (!input.email.endsWith("@gmail.com")) {
    logger.warn("Invalid email domain", { email: input.email })
    throw new DomainError("Only Gmail accounts allowed")
  }

  const user = await insertUser(input)

  logger.info("User created", { userId: user.id })

  return user
}
