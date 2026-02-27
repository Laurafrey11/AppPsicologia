export class BaseError extends Error {
  public statusCode: number
  public code: string

  constructor(message: string, statusCode = 400, code = "BAD_REQUEST") {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}
