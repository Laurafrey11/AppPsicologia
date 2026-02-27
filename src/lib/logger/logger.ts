type LogLevel = "info" | "error" | "warn"

function log(level: LogLevel, message: string, meta?: any) {
  const payload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(meta && { meta })
  }

  console.log(JSON.stringify(payload))
}

export const logger = {
  info: (msg: string, meta?: any) => log("info", msg, meta),
  error: (msg: string, meta?: any) => log("error", msg, meta),
  warn: (msg: string, meta?: any) => log("warn", msg, meta)
}
