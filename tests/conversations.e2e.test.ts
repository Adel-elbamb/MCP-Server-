import "dotenv/config";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createApp } from "../src/app.js";
import { normalizeAuthorization } from "../src/clients/reports.client.js";
import { loadEnv } from "../src/config/env.js";

/**
 * Runs against a real reports-businesschat instance. Opt-in:
 *   E2E=1 npm test
 * Requires REPORTS_BASE_URL, REPORTS_TOKEN and REPORTS_WORKSPACE_ID (in .env or the shell).
 * Optional E2E_START_DATE / E2E_END_DATE (default: last 30 days).
 */
const enabled = process.env.E2E === "1";

describe("conversations E2E against local reports", { skip: !enabled && "set E2E=1 to run" }, () => {
  const env = loadEnv({ ...process.env, HOST: "127.0.0.1" });
  const endDate = process.env.E2E_END_DATE ?? new Date().toISOString();
  const startDate =
    process.env.E2E_START_DATE ?? new Date(Date.parse(endDate) - 30 * 24 * 60 * 60 * 1000).toISOString();

  let httpServer: Server;
  let client: Client;

  before(async () => {
    assert.ok(env.REPORTS_TOKEN, "REPORTS_TOKEN must be set for E2E");
    assert.ok(env.REPORTS_WORKSPACE_ID, "REPORTS_WORKSPACE_ID must be set for E2E");

    // The app's .env fallbacks are disabled so the test proves header pass-through.
    const app = createApp({ env: { ...env, REPORTS_TOKEN: undefined, REPORTS_WORKSPACE_ID: undefined } });
    httpServer = await new Promise<Server>((resolve) => {
      const server = app.listen(0, "127.0.0.1", () => resolve(server));
    });
    const { port } = httpServer.address() as AddressInfo;

    client = new Client({ name: "e2e-client", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: {
          headers: {
            Authorization: normalizeAuthorization(env.REPORTS_TOKEN) as string,
            "x-workspace-id": env.REPORTS_WORKSPACE_ID as string,
          },
        },
      }),
    );
  });

  after(async () => {
    await client?.close();
    await new Promise<void>((resolve) => (httpServer ? httpServer.close(() => resolve()) : resolve()));
  });

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
    const first = result.content[0];
    const text = first && first.type === "text" ? first.text : "";
    assert.equal(result.isError ?? false, false, `${name} failed: ${text}`);
    return JSON.parse(text);
  };

  it("get_conversations_summary view=totals", async () => {
    const result = await call("get_conversations_summary", {
      view: "totals",
      start_date: startDate,
      end_date: endDate,
    });
    assert.equal(typeof result.computed.total, "number");
    assert.equal(result.computed.total, result.computed.opened + result.computed.closed);
  });

  it("get_conversations_summary view=hourly", async () => {
    const result = await call("get_conversations_summary", {
      view: "hourly",
      start_date: startDate,
      end_date: endDate,
    });
    assert.ok(result.data);
  });

  it("get_conversations_summary view=breakdown", async () => {
    const result = await call("get_conversations_summary", {
      view: "breakdown",
      start_date: startDate,
      end_date: endDate,
      group_by: "channel",
    });
    assert.ok(Array.isArray(result.computed.groups));
  });

  it("get_conversations_list", async () => {
    const result = await call("get_conversations_list", {
      start_date: startDate,
      end_date: endDate,
      status: "Closed",
      limit: 5,
    });
    assert.ok(Array.isArray(result.rows));
    assert.ok(result.rows.length <= 5);
  });

  it("get_conversations_closed_by_ai", async () => {
    const result = await call("get_conversations_closed_by_ai", { start_date: startDate, end_date: endDate });
    assert.ok(result.data);
  });
});
