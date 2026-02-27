type LogLevel = "info" | "error" | "warn"

function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  console[level === "warn" ? "warn" : level === "error" ? "error" : "log"](
    JSON.stringify({ level, message, timestamp: new Date().toISOString(), ...(meta && { meta }) })
  )
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => log("info", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log("error", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log("warn", msg, meta),
}
