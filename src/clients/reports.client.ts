import { MissingContextError, UpstreamError } from "../common/errors/index.js";
import { logger as rootLogger, type Logger } from "../common/logger/logger.js";

export interface RequestContext {
  /** Full Authorization header value, e.g. "Bearer eyJ...". */
  authorization?: string | undefined;
  workspaceId?: string | undefined;
}

export interface ReportsClientOptions {
  baseUrl: string;
  timeoutMs: number;
  logger?: Logger;
}

export class ReportsClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly logger: Logger;

  constructor(options: ReportsClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs;
    this.logger = (options.logger ?? rootLogger).child({ component: "ReportsClient" });
  }

  async post<T = unknown>(path: string, body: Record<string, unknown>, ctx: RequestContext): Promise<T> {
    const missing: string[] = [];
    if (!ctx.authorization) missing.push("Authorization");
    if (!ctx.workspaceId) missing.push("x-workspace-id");
    if (missing.length > 0) throw new MissingContextError(missing);

    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await globalThis.fetch(url, {
        method: "POST",
        headers: {
          Authorization: ctx.authorization as string,
          "x-workspace-id": ctx.workspaceId as string,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const payload = await parseBody(response);
      this.logger.debug("reports request completed", {
        path,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });

      if (!response.ok) {
        this.logger.warn("reports request failed", { path, status: response.status, body: payload });
        throw new UpstreamError(path, response.status, payload);
      }
      return payload as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Accepts either a raw JWT or a full "Bearer ..." value and returns the header value. */
export function normalizeAuthorization(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return /^bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}
