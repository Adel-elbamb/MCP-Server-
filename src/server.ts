import "dotenv/config";
import { createApp } from "./app.js";
import { logger } from "./common/logger/logger.js";
import { getEnv } from "./config/env.js";

const env = getEnv();
const app = createApp({ env });

const httpServer = app.listen(env.PORT, env.HOST, () => {
  logger.info("MCP reports server listening", {
    url: `http://${env.HOST}:${env.PORT}/mcp`,
    reportsBaseUrl: env.REPORTS_BASE_URL,
    fallbackAuthConfigured: Boolean(env.REPORTS_TOKEN),
    fallbackWorkspaceId: env.REPORTS_WORKSPACE_ID ?? null,
  });
});

httpServer.on("error", (error) => {
  logger.error("HTTP server error", { error });
  process.exit(1);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutting down", { signal });
  httpServer.close((error) => {
    if (error) logger.error("error while closing HTTP server", { error });
    process.exit(error ? 1 : 0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
