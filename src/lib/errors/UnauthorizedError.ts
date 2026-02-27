import { BaseError } from "./BaseError"

/** Thrown when a request lacks valid authentication. Maps to HTTP 401. */
export class UnauthorizedError extends BaseError {
  constructor(message = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED")
  }
}
