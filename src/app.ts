import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { Express, NextFunction, Request, Response } from "express";
import { ReportsClient } from "./clients/reports.client.js";
import { logger } from "./common/logger/logger.js";
import type { Env } from "./config/env.js";
import { createMcpPostHandler, methodNotAllowed } from "./mcp/mcp.transport.js";
import { SERVER_NAME, SERVER_VERSION } from "./mcp/mcp.server.js";

export interface CreateAppOptions {
  env: Env;
  client?: ReportsClient;
}

export function createApp({ env, client }: CreateAppOptions): Express {
  const reportsClient = client ?? new ReportsClient({ baseUrl: env.REPORTS_BASE_URL, timeoutMs: env.REPORTS_TIMEOUT_MS });

  // Applies DNS-rebinding protection when bound to localhost, then express.json().
  const app = createMcpExpressApp({ host: env.HOST });

  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, x-workspace-id, mcp-session-id, mcp-protocol-version, Last-Event-ID",
    );
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id, mcp-protocol-version");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", name: SERVER_NAME, version: SERVER_VERSION, reportsBaseUrl: env.REPORTS_BASE_URL });
  });

  app.post(
    "/mcp",
    createMcpPostHandler({
      client: reportsClient,
      fallbackToken: env.REPORTS_TOKEN,
      fallbackWorkspaceId: env.REPORTS_WORKSPACE_ID,
    }),
  );
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error("unhandled express error", { error });
    if (res.headersSent) return;
    const status =
      typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 500;
    res.status(status).json({ error: status === 500 ? "Internal server error" : (error as Error).message });
  });

  return app;
}
