export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, options: { code?: string; statusCode?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = options.code ?? "APP_ERROR";
    this.statusCode = options.statusCode ?? 500;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, { code: "VALIDATION_ERROR", statusCode: 400 });
    this.name = "ValidationError";
  }
}

export class MissingContextError extends AppError {
  constructor(missing: string[]) {
    super(
      `Missing required request context: ${missing.join(", ")}. ` +
        "Send them as HTTP headers on the MCP request (Authorization, x-workspace-id) " +
        "or set REPORTS_TOKEN / REPORTS_WORKSPACE_ID in .env for local testing.",
      { code: "MISSING_CONTEXT", statusCode: 401 },
    );
    this.name = "MissingContextError";
  }
}

export class UpstreamError extends AppError {
  readonly upstreamStatus: number;
  readonly upstreamBody: unknown;
  readonly path: string;

  constructor(path: string, status: number, body: unknown) {
    super(`Reports API ${path} responded with HTTP ${status}: ${summarizeBody(body)}`, {
      code: "UPSTREAM_ERROR",
      statusCode: 502,
    });
    this.name = "UpstreamError";
    this.path = path;
    this.upstreamStatus = status;
    this.upstreamBody = body;
  }
}

function summarizeBody(body: unknown): string {
  if (body === null || body === undefined || body === "") return "(empty body)";
  if (typeof body === "string") return body.slice(0, 500);
  if (typeof body === "object") {
    const message = (body as { message?: unknown }).message;
    if (Array.isArray(message)) return message.join("; ");
    if (typeof message === "string") return message;
    return JSON.stringify(body).slice(0, 500);
  }
  return String(body);
}
