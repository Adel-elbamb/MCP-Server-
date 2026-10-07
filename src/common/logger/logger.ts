type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEYS = /authorization|token|secret|password|cookie/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, val]) => [
      key,
      SENSITIVE_KEYS.test(key) ? "[REDACTED]" : redact(val, depth + 1),
    ]),
  );
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(
  level: LogLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info",
  bindings: Record<string, unknown> = {},
): Logger {
  const threshold = LEVEL_WEIGHT[level] ?? LEVEL_WEIGHT.info;

  // stderr keeps stdout free for protocol traffic if a stdio transport is ever added.
  const write = (lvl: LogLevel, message: string, meta?: Record<string, unknown>) => {
    if (LEVEL_WEIGHT[lvl] < threshold) return;
    const line = {
      time: new Date().toISOString(),
      level: lvl,
      msg: message,
      ...(redact(bindings) as Record<string, unknown>),
      ...(meta ? (redact(meta) as Record<string, unknown>) : {}),
    };
    process.stderr.write(`${JSON.stringify(line)}\n`);
  };

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta),
    child: (extra) => createLogger(level, { ...bindings, ...extra }),
  };
}

export const logger = createLogger();
