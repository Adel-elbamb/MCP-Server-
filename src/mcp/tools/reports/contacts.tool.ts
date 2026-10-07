import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDeps } from "./conversations.tool.js";

/**
 * Contact reports (POST /reports/contacts/overview, added-by-source, connected-by-channel, connected-list).
 * Phase 2: see MCP_REQUIRED_APIS_AND_FILTERS.md section 2.8.
 */
export function registerContactReportTools(_server: McpServer, _deps: ToolDeps): void {}
