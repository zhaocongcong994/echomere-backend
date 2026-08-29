export type LogLevel = "debug" | "info" | "warn" | "error";

export interface StructuredLogger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

const REDACTED_FIELD = /authorization|cookie|password|secret|token|api[-_]?key/iu;

export function createJsonLogger(
  service = "echomere-agent",
  minimumLevel = readLogLevel(process.env.LOG_LEVEL),
): StructuredLogger {
  const threshold = levelPriority(minimumLevel);
  const write = (
    level: LogLevel,
    event: string,
    fields: Record<string, unknown> = {},
  ): void => {
    if (levelPriority(level) < threshold) return;
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service,
      event,
      ...sanitizeFields(fields),
    });
    if (level === "error") process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  };
  return {
    debug: (event, fields) => write("debug", event, fields),
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
  };
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { error: String(error) };
  return {
    errorName: error.name,
    errorMessage: error.message,
    ...(error.stack ? { errorStack: error.stack } : {}),
  };
}

function sanitizeFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      REDACTED_FIELD.test(key) ? "[REDACTED]" : sanitizeValue(value),
    ]),
  );
}

function sanitizeValue(value: unknown): unknown {
  if (value instanceof Error) return sanitizeFields(serializeError(value));
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    return sanitizeFields(value as Record<string, unknown>);
  }
  return value;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/giu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED_API_KEY]")
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/giu,
      "$1[REDACTED]@",
    );
}

function readLogLevel(value: string | undefined): LogLevel {
  return value === "debug" || value === "warn" || value === "error"
    ? value
    : "info";
}

function levelPriority(level: LogLevel): number {
  return { debug: 10, info: 20, warn: 30, error: 40 }[level];
}
