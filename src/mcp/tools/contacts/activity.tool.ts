import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDeps } from "../reports/conversations.tool.js";

/**
 * Contact activity (POST /reports/contacts/list: added/deleted events by user/source).
 * Phase 2: see MCP_REQUIRED_APIS_AND_FILTERS.md section 2.8.
 */
export function registerContactActivityTools(_server: McpServer, _deps: ToolDeps): void {}
