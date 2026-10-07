# mcp-reports-server

MCP server (Express + Streamable HTTP, stateless) that exposes `reports-businesschat` as MCP tools.

Tools (phase 1, conversations):

| Tool | Reports endpoint |
|---|---|
| `get_conversations_summary` (`view=totals`) | `POST /reports/conversations/overview` |
| `get_conversations_summary` (`view=hourly`) | `POST /reports/conversations/conversation-heatmap` |
| `get_conversations_summary` (`view=breakdown`) | `POST /reports/conversations/opened-closed` |
| `get_conversations_list` | `POST /reports/conversations/list` |
| `get_conversations_closed_by_ai` | `POST /reports/conversations/closed-ai` |

Every MCP request must carry `Authorization: Bearer <user JWT>` and `x-workspace-id`; they are forwarded to reports as-is. For local testing, `REPORTS_TOKEN` / `REPORTS_WORKSPACE_ID` in `.env` are used when the headers are absent.

## Run locally

1. **Reports service** (`../reports-businesschat`): make sure MongoDB (`localhost:2717`), OpenSearch (`localhost:9200`) and Redis from its `.env` are reachable, keep `BYPASS_PERMISSIONS=true`, then:
   ```bash
   npm run start:dev
   curl localhost:3006/api/v1/health
   ```
2. **Dev JWT** signed with the reports `JWT_SECRET`:
   ```bash
   JWT_SECRET=$(grep '^JWT_SECRET=' ../reports-businesschat/.env | cut -d= -f2-) npm run -s dev:token
   ```
   Put it in `.env` as `REPORTS_TOKEN`, and set `REPORTS_WORKSPACE_ID` to a workspace that has data in OpenSearch.
3. **MCP server**:
   ```bash
   cp .env.example .env   # first time only
   npm install
   npm run dev
   curl localhost:3010/health
   ```
4. **MCP Inspector**: `npx @modelcontextprotocol/inspector`, transport "Streamable HTTP", URL `http://localhost:3010/mcp`, add the `Authorization` and `x-workspace-id` headers (or rely on the `.env` fallbacks), then list and call the tools.
5. **Cursor** (optional), `.cursor/mcp.json`:
   ```json
   {
     "mcpServers": {
       "reports": {
         "url": "http://localhost:3010/mcp",
         "headers": { "Authorization": "Bearer <jwt>", "x-workspace-id": "<workspace-id>" }
       }
     }
   }
   ```

## Tests

```bash
npm test          # unit + tool tests (reports is stubbed)
npm run test:e2e  # real local reports; needs REPORTS_TOKEN / REPORTS_WORKSPACE_ID
                  # optional E2E_START_DATE / E2E_END_DATE (default: last 30 days)
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Watch mode via tsx |
| `npm run build` / `npm start` | Compile to `dist/` and run |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run dev:token` | Sign a local dev JWT for reports |
