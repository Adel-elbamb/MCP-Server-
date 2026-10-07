import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import { normalizeAuthorization, type ReportsClient, type RequestContext } from "../clients/reports.client.js";
import { logger as rootLogger } from "../common/logger/logger.js";
import { createMcpServer } from "./mcp.server.js";

export interface McpHandlerOptions {
  client: ReportsClient;
  fallbackToken?: string | undefined;
  fallbackWorkspaceId?: string | undefined;
}

const logger = rootLogger.child({ component: "McpTransport" });

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function extractRequestContext(req: Request, options: McpHandlerOptions): RequestContext {
  return {
    authorization: normalizeAuthorization(headerValue(req, "authorization") ?? options.fallbackToken),
    workspaceId: headerValue(req, "x-workspace-id")?.trim() || options.fallbackWorkspaceId,
  };
}

/** Stateless Streamable HTTP: a fresh server + transport per POST so each call carries its own JWT/workspace. */
export function createMcpPostHandler(options: McpHandlerOptions) {
  return async (req: Request, res: Response): Promise<void> => {
    const ctx = extractRequestContext(req, options);
    const server = createMcpServer(options.client, ctx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error("failed to handle MCP request", { error });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  };
}

export function methodNotAllowed(req: Request, res: Response): void {
  if (req.method === "GET" && !headerValue(req, "accept")?.includes("text/event-stream")) {
    res.json({
      status: "ok",
      message:
        "MCP endpoint is running. Browsers cannot use it: add this URL as an MCP server / connector in your " +
        "AI client (ChatGPT, Cursor, MCP Inspector), which talks to it with POST requests.",
    });
    return;
  }
  res
    .status(405)
    .set("Allow", "POST")
    .json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. This server is stateless; use POST /mcp." },
      id: null,
    });
}
