import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ReportsClient, type RequestContext } from "../src/clients/reports.client.js";
import { createMcpServer } from "../src/mcp/mcp.server.js";

const BASE_URL = "http://reports.test/api/v1";
const CTX: RequestContext = { authorization: "Bearer test-jwt", workspaceId: "ws-123" };
const RANGE = { start_date: "2026-09-01T00:00:00Z", end_date: "2026-09-30T23:59:59Z" };

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: RecordedCall[] = [];
let nextResponse: { status: number; body: unknown } = { status: 200, body: {} };
const originalFetch = globalThis.fetch;

async function connect(ctx: RequestContext = CTX) {
  const server = createMcpServer(new ReportsClient({ baseUrl: BASE_URL, timeoutMs: 2000 }), ctx);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function parseResult(result: unknown): { isError: boolean; text: string; json: any } {
  const typed = result as CallToolResult;
  const first = typed.content[0];
  const text = first && first.type === "text" ? first.text : "";
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { isError: typed.isError === true, text, json };
}

beforeEach(() => {
  calls = [];
  nextResponse = { status: 200, body: {} };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify(nextResponse.body), {
      status: nextResponse.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("conversation tools over MCP", () => {
  it("lists the conversation tools", async () => {
    const { client, close } = await connect();
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ["get_conversations_closed_by_ai", "get_conversations_list", "get_conversations_summary"],
    );
    await close();
  });

  it("get_conversations_summary totals: forwards headers, whitelisted body, computes shares", async () => {
    nextResponse = {
      status: 200,
      body: { data: { summary: { opened: 60, closed: 40, openedPercentage: 20, closedPercentage: -10 } } },
    };
    const { client, close } = await connect();
    const result = parseResult(
      await client.callTool({
        name: "get_conversations_summary",
        arguments: { view: "totals", ...RANGE, contact_type: ["New"], closed_by_user: ["u-1"] },
      }),
    );
    await close();

    assert.equal(result.isError, false);
    assert.equal(calls.length, 1);
    const call = calls[0]!;
    assert.equal(call.url, `${BASE_URL}/reports/conversations/overview`);
    assert.equal(call.headers.authorization, "Bearer test-jwt");
    assert.equal(call.headers["x-workspace-id"], "ws-123");
    assert.equal(call.headers["content-type"], "application/json");
    assert.deepEqual(call.body, {
      startDate: RANGE.start_date,
      endDate: RANGE.end_date,
      conversationContactType: ["New"],
    });

    assert.equal(result.json.computed.total, 100);
    assert.equal(result.json.computed.openedSharePct, 60);
    assert.equal(result.json.computed.openedChangeVsPreviousPct, 20);
    assert.match(result.json.warnings[0], /closed_by_user/);
  });

  it("get_conversations_summary hourly and breakdown hit the right endpoints", async () => {
    const { client, close } = await connect();
    await client.callTool({ name: "get_conversations_summary", arguments: { view: "hourly", ...RANGE } });
    await client.callTool({
      name: "get_conversations_summary",
      arguments: { view: "breakdown", ...RANGE, group_by: "source", status: "Closed" },
    });
    await close();

    assert.deepEqual(
      calls.map((c) => c.url),
      [`${BASE_URL}/reports/conversations/conversation-heatmap`, `${BASE_URL}/reports/conversations/opened-closed`],
    );
    assert.deepEqual(calls[1]!.body, {
      startDate: RANGE.start_date,
      endDate: RANGE.end_date,
      status: "Closed",
      groupBy: "source",
    });
  });

  it("get_conversations_list returns meta and rows", async () => {
    nextResponse = {
      status: 200,
      body: {
        data: {
          data: [{ visibleId: 1001 }, { visibleId: 1002 }],
          meta: { total: 2, current_page: 1, per_page: 10, last_page: 1 },
          totalRecords: 2,
        },
      },
    };
    const { client, close } = await connect();
    const result = parseResult(
      await client.callTool({
        name: "get_conversations_list",
        arguments: { ...RANGE, status: "Opened", limit: 5, first_assignee: ["none"] },
      }),
    );
    await close();

    assert.equal(result.isError, false);
    assert.equal(calls[0]!.url, `${BASE_URL}/reports/conversations/list`);
    const body = calls[0]!.body as Record<string, unknown>;
    assert.equal(body.status, "Opened");
    assert.equal(body.limit, 5);
    assert.deepEqual(body.firstAssignee, ["none"]);
    assert.equal(result.json.meta.total, 2);
    assert.equal(result.json.rows.length, 2);
  });

  it("maps a 400 from reports to isError with the API message", async () => {
    nextResponse = { status: 400, body: { statusCode: 400, message: ["property foo should not exist"] } };
    const { client, close } = await connect();
    const result = parseResult(
      await client.callTool({ name: "get_conversations_closed_by_ai", arguments: RANGE }),
    );
    await close();

    assert.equal(result.isError, true);
    assert.match(result.text, /HTTP 400/);
    assert.match(result.text, /property foo should not exist/);
  });

  it("returns isError without calling reports when auth context is missing", async () => {
    const { client, close } = await connect({});
    const result = parseResult(
      await client.callTool({ name: "get_conversations_summary", arguments: { view: "totals", ...RANGE } }),
    );
    await close();

    assert.equal(result.isError, true);
    assert.match(result.text, /Authorization, x-workspace-id/);
    assert.equal(calls.length, 0);
  });

  it("rejects invalid arguments before calling reports", async () => {
    const { client, close } = await connect();
    const result = parseResult(
      await client.callTool({
        name: "get_conversations_list",
        arguments: { ...RANGE, limit: 500 },
      }),
    );
    await close();

    assert.equal(result.isError, true);
    assert.equal(calls.length, 0);
  });
});
