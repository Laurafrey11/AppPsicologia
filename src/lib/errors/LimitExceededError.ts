import { BaseError } from "./BaseError"

/** Thrown when a psychologist exceeds a plan usage limit. Maps to HTTP 429. */
export class LimitExceededError extends BaseError {
  constructor(message: string) {
    super(message, 429, "LIMIT_EXCEEDED")
  }
}
