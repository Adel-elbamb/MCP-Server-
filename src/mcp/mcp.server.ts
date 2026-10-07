import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReportsClient, RequestContext } from "../clients/reports.client.js";
import { registerContactActivityTools } from "./tools/contacts/activity.tool.js";
import { registerContactReportTools } from "./tools/reports/contacts.tool.js";
import { registerConversationTools } from "./tools/reports/conversations.tool.js";

export const SERVER_NAME = "mcp-reports-server";
export const SERVER_VERSION = "1.0.0";

export function createMcpServer(client: ReportsClient, ctx: RequestContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Business Chat reporting tools. All dates are ISO-8601 UTC; convert workspace-local day boundaries to UTC " +
        "before calling. Filters that take IDs (channels, users, teams, categories, contacts) need IDs, not names.",
    },
  );

  const deps = { client, ctx };
  registerConversationTools(server, deps);
  registerContactReportTools(server, deps);
  registerContactActivityTools(server, deps);

  return server;
}
