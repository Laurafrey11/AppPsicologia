import { BaseError } from "./BaseError"

export class DomainError extends BaseError {
  constructor(message: string) {
    super(message, 422, "DOMAIN_ERROR")
  }
}
