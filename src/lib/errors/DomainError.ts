import { BaseError } from "./BaseError"

/** Thrown for domain-level violations (not found, forbidden, etc.). Maps to HTTP 400. */
export class DomainError extends BaseError {
  constructor(message: string) {
    super(message, 400, "DOMAIN_ERROR")
  }
}
