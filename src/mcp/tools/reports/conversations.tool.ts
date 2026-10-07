import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ReportsClient, RequestContext } from "../../../clients/reports.client.js";
import { toToolError, toToolResult, ValidationError } from "../../../common/errors/index.js";

// ---------------------------------------------------------------------------
// Filter mapping (MCP snake_case param -> Reports API field)
// ---------------------------------------------------------------------------

export const CONVERSATION_FILTER_FIELDS = {
  conversation_opened_source: "conversationOpenedBySource",
  conversation_closed_source: "conversationClosedBySource",
  contact_type: "conversationContactType",
  conversation_opened_channel: "conversationChannel",
  contact: "conversationContact",
  conversation_id: "conversationIds",
  first_assignee: "firstAssignee",
  last_assignee: "lastAssignee",
  first_response_by: "firstResponseBy",
  closed_by_team: "closedByTeam",
  closed_by_user: "closedByUser",
  conversation_category: "conversationCategory",
  is_ai: "isAi",
  is_closed_by_ai: "isClosedByAi",
} as const;

export type ConversationFilterParam = keyof typeof CONVERSATION_FILTER_FIELDS;
export type ConversationFilterInput = Partial<Record<ConversationFilterParam, unknown>>;

const ALL_STORY_FILTERS: readonly ConversationFilterParam[] = [
  "conversation_opened_source",
  "conversation_closed_source",
  "contact_type",
  "conversation_opened_channel",
  "contact",
  "conversation_id",
  "first_assignee",
  "last_assignee",
  "first_response_by",
  "closed_by_team",
  "closed_by_user",
  "conversation_category",
];

/** Filters #1, #3, #4, #5, #6: the only story filters honoured by overview and by opened-closed with status=Opened. */
const OPENED_SCOPE_FILTERS: readonly ConversationFilterParam[] = [
  "conversation_opened_source",
  "contact_type",
  "conversation_opened_channel",
  "contact",
  "conversation_id",
];

export const ALLOWED_FILTERS = {
  overview: [...OPENED_SCOPE_FILTERS, "is_ai"],
  heatmap: [...ALL_STORY_FILTERS, "is_ai"],
  openedClosedOpened: [...OPENED_SCOPE_FILTERS, "is_ai"],
  openedClosedClosed: [...ALL_STORY_FILTERS, "is_ai"],
  list: [...ALL_STORY_FILTERS, "is_ai", "is_closed_by_ai"],
} as const satisfies Record<string, readonly ConversationFilterParam[]>;

export interface MappedFilters {
  body: Record<string, unknown>;
  dropped: ConversationFilterParam[];
}

export function mapConversationFilters(
  input: ConversationFilterInput,
  allowed: readonly ConversationFilterParam[],
): MappedFilters {
  const allowedSet = new Set<ConversationFilterParam>(allowed);
  const body: Record<string, unknown> = {};
  const dropped: ConversationFilterParam[] = [];

  for (const param of Object.keys(CONVERSATION_FILTER_FIELDS) as ConversationFilterParam[]) {
    const value = input[param];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (!allowedSet.has(param)) {
      dropped.push(param);
      continue;
    }
    body[CONVERSATION_FILTER_FIELDS[param]] = value;
  }
  return { body, dropped };
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

const isoDate = (description: string) =>
  z
    .string()
    .regex(ISO_DATE, "Must be an ISO-8601 date or date-time, e.g. 2026-09-01T00:00:00Z")
    .refine((value) => !Number.isNaN(Date.parse(value)), "Not a valid date")
    .describe(description);

const idList = (description: string) => z.array(z.string().min(1)).min(1).optional().describe(description);

const dateRangeShape = {
  start_date: isoDate("Period start (inclusive), ISO-8601 in UTC. Convert the workspace-local day start to UTC."),
  end_date: isoDate("Period end (inclusive), ISO-8601 in UTC."),
};

const conversationFilterShape = {
  conversation_opened_source: z
    .array(z.enum(["User", "Contact", "Developer API", "Campaign", "Workflows", "Paid Ads", "Ads"]))
    .min(1)
    .optional()
    .describe("Filter #1: who/what opened the conversation."),
  conversation_closed_source: z
    .array(z.enum(["User", "System", "Workflows", "Developer API"]))
    .min(1)
    .optional()
    .describe("Filter #2: who/what closed the conversation."),
  contact_type: z.array(z.enum(["New", "Returning"])).min(1).optional().describe("Filter #3: contact type."),
  conversation_opened_channel: idList("Filter #4: channel IDs the conversation was opened on."),
  contact: idList("Filter #5: conversations-service contact IDs (Mongo _id, not the Contact Service ULID)."),
  conversation_id: z
    .array(z.number().int().positive())
    .min(1)
    .optional()
    .describe("Filter #6: visible conversation numbers, e.g. 226473."),
  first_assignee: idList('Filter #7: first assignee user IDs; "none" = unassigned.'),
  last_assignee: idList('Filter #8: last assignee user IDs; "none" supported.'),
  first_response_by: idList('Filter #9: first responder user IDs; "none" supported.'),
  closed_by_team: idList('Filter #10: closing team IDs (identity service); "none" supported.'),
  closed_by_user: idList("Filter #11: closing user IDs."),
  conversation_category: idList("Filter #12: closing-note (category) IDs."),
  is_ai: z.boolean().optional().describe("Only conversations with AI actions."),
};

export const SummaryInputSchema = z.object({
  view: z
    .enum(["totals", "hourly", "breakdown"])
    .describe(
      "totals = opened/closed counts + time series; hourly = weekday x hour heatmap; breakdown = grouped by contactType/source/channel/category.",
    ),
  ...dateRangeShape,
  status: z
    .enum(["Opened", "Closed"])
    .optional()
    .describe("hourly/breakdown only. Which timestamp to count on. Default Opened."),
  group_by: z
    .enum(["contactType", "source", "channel", "category"])
    .optional()
    .describe("breakdown only. Default contactType."),
  include_comparison: z
    .boolean()
    .optional()
    .describe("totals/breakdown only. Include previous-period comparison. Default true."),
  ...conversationFilterShape,
});
export type SummaryInput = z.infer<typeof SummaryInputSchema>;

export const LIST_SORT_FIELDS = [
  "visibleId",
  "openedTimestamp",
  "closedTimestamp",
  "firstAssignmentTimestamp",
  "firstResponseTimestamp",
  "lastAssignmentTimestamp",
  "resolutionTime",
  "firstResponseTime",
  "timeToFirstAssignment",
] as const;

const LIST_SORT_VALUES = LIST_SORT_FIELDS.flatMap((field) => [field, `-${field}`]) as [string, ...string[]];

export const LIST_COLUMNS = [
  "visibleId", "conversationId", "openedTimestamp", "closedTimestamp", "openedBySource", "openedByChannel",
  "closedBySource", "closedBy", "closedByTeam", "contactName", "contactType", "firstAssignmentTimestamp",
  "firstAssignee", "lastAssignmentTimestamp", "lastAssignee", "firstResponseTimestamp", "timeToFirstAssignment",
  "firstResponseTime", "firstAssignmentToFirstResponseTime", "lastAssignmentToResponseTime", "resolutionTime",
  "firstAssignmentToCloseTime", "lastAssignmentToCloseTime", "averageResponseTime", "assignments",
  "incomingMessages", "outgoingMessages", "responses", "conversationCategory", "summary", "channelInfo", "contact",
  "closedByInfo", "firstAssigneeInfo", "lastAssigneeInfo", "currentAssigneeInfo", "firstResponseByInfo",
  "closedByTeamInfo", "firstAssigneeTeamInfo", "lastAssigneeTeamInfo", "currentAssigneeTeamInfo",
  "firstResponseByTeamInfo",
] as const;

/** Without an explicit column list the API returns every column, including contact email/phone. */
export const DEFAULT_LIST_COLUMNS: readonly (typeof LIST_COLUMNS)[number][] = [
  "visibleId",
  "openedTimestamp",
  "closedTimestamp",
  "openedBySource",
  "openedByChannel",
  "closedBySource",
  "closedBy",
  "contactName",
  "contactType",
  "firstAssignee",
  "lastAssignee",
  "firstResponseTime",
  "resolutionTime",
  "conversationCategory",
];

export const ListInputSchema = z.object({
  ...dateRangeShape,
  status: z
    .enum(["Opened", "Closed"])
    .optional()
    .describe("Opened = filter on openedTimestamp; Closed = only closed conversations, filtered on closedTimestamp. Default Closed."),
  page: z.number().int().min(1).optional().describe("Page number, default 1."),
  limit: z.number().int().min(5).max(100).optional().describe("Rows per page, 5-100, default 10."),
  sort: z
    .enum(LIST_SORT_VALUES)
    .optional()
    .describe('Sort field; prefix "-" for descending. Default -openedTimestamp.'),
  columns: z
    .array(z.enum(LIST_COLUMNS))
    .min(1)
    .optional()
    .describe("Columns to return. Defaults to a compact set without contact PII."),
  ...conversationFilterShape,
  is_closed_by_ai: z.boolean().optional().describe("Only conversations closed by AI."),
});
export type ListInput = z.infer<typeof ListInputSchema>;

export const ClosedByAiInputSchema = z.object(dateRangeShape);
export type ClosedByAiInput = z.infer<typeof ClosedByAiInputSchema>;

// ---------------------------------------------------------------------------
// Request builders
// ---------------------------------------------------------------------------

export const CONVERSATION_PATHS = {
  overview: "/reports/conversations/overview",
  heatmap: "/reports/conversations/conversation-heatmap",
  openedClosed: "/reports/conversations/opened-closed",
  list: "/reports/conversations/list",
  closedAi: "/reports/conversations/closed-ai",
} as const;

export interface BuiltRequest {
  path: string;
  body: Record<string, unknown>;
  warnings: string[];
}

function pickFilters(input: Record<string, unknown>): ConversationFilterInput {
  const filters: ConversationFilterInput = {};
  for (const param of Object.keys(CONVERSATION_FILTER_FIELDS) as ConversationFilterParam[]) {
    if (input[param] !== undefined) filters[param] = input[param];
  }
  return filters;
}

function assertDateOrder(startDate: string, endDate: string, strict = false): void {
  const start = Date.parse(startDate);
  const end = Date.parse(endDate);
  if (strict ? start >= end : start > end) {
    throw new ValidationError(`start_date must be ${strict ? "before" : "on or before"} end_date.`);
  }
}

export function buildSummaryRequest(input: SummaryInput): BuiltRequest {
  assertDateOrder(input.start_date, input.end_date);
  const filters = pickFilters(input);
  const warnings: string[] = [];
  const base = { startDate: input.start_date, endDate: input.end_date };

  const ignore = (field: string, views: string) => {
    if ((input as Record<string, unknown>)[field] !== undefined) {
      warnings.push(`"${field}" is only used by view=${views}; ignored for view=${input.view}.`);
    }
  };

  switch (input.view) {
    case "totals": {
      ignore("status", "hourly|breakdown");
      ignore("group_by", "breakdown");
      const mapped = mapConversationFilters(filters, ALLOWED_FILTERS.overview);
      if (mapped.dropped.length > 0) {
        warnings.push(
          `Filters not supported by view=totals were ignored: ${mapped.dropped.join(", ")}. ` +
            "For a count with these filters use get_conversations_list and read meta.total.",
        );
      }
      return {
        path: CONVERSATION_PATHS.overview,
        body: {
          ...base,
          ...(input.include_comparison === undefined ? {} : { includeComparison: input.include_comparison }),
          ...mapped.body,
        },
        warnings,
      };
    }
    case "hourly": {
      ignore("group_by", "breakdown");
      ignore("include_comparison", "totals|breakdown");
      const mapped = mapConversationFilters(filters, ALLOWED_FILTERS.heatmap);
      return {
        path: CONVERSATION_PATHS.heatmap,
        body: { ...base, status: input.status ?? "Opened", ...mapped.body },
        warnings,
      };
    }
    case "breakdown": {
      const status = input.status ?? "Opened";
      const allowed = status === "Opened" ? ALLOWED_FILTERS.openedClosedOpened : ALLOWED_FILTERS.openedClosedClosed;
      const mapped = mapConversationFilters(filters, allowed);
      if (mapped.dropped.length > 0) {
        warnings.push(
          `Filters ignored by the API when status=Opened: ${mapped.dropped.join(", ")}. ` +
            "Use status=Closed, or get_conversations_list for a filtered count.",
        );
      }
      return {
        path: CONVERSATION_PATHS.openedClosed,
        body: {
          ...base,
          status,
          groupBy: input.group_by ?? "contactType",
          ...(input.include_comparison === undefined ? {} : { includeComparison: input.include_comparison }),
          ...mapped.body,
        },
        warnings,
      };
    }
  }
}

export function buildListRequest(input: ListInput): BuiltRequest {
  assertDateOrder(input.start_date, input.end_date);
  const mapped = mapConversationFilters(pickFilters(input), ALLOWED_FILTERS.list);
  return {
    path: CONVERSATION_PATHS.list,
    body: {
      startDate: input.start_date,
      endDate: input.end_date,
      status: input.status ?? "Closed",
      page: input.page ?? 1,
      limit: input.limit ?? 10,
      sort: input.sort ?? "-openedTimestamp",
      columns: input.columns ?? [...DEFAULT_LIST_COLUMNS],
      ...mapped.body,
    },
    warnings: [],
  };
}

export function buildClosedByAiRequest(input: ClosedByAiInput): BuiltRequest {
  assertDateOrder(input.start_date, input.end_date, true);
  return {
    path: CONVERSATION_PATHS.closedAi,
    body: { startDate: input.start_date, endDate: input.end_date },
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Derived values. The API's *Percentage fields are change vs previous period,
// never share of total, so shares are computed here.
// ---------------------------------------------------------------------------

const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const share = (part: number, total: number) => (total > 0 ? round((part / total) * 100) : 0);
const toNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export interface TotalsComputed {
  opened: number;
  closed: number;
  total: number;
  openedSharePct: number;
  closedSharePct: number;
  openedChangeVsPreviousPct: number | null;
  closedChangeVsPreviousPct: number | null;
}

export function computeTotals(response: unknown): TotalsComputed {
  const root = (response as { data?: unknown } | null)?.data ?? response;
  const summary = ((root as { summary?: Record<string, unknown> } | null)?.summary ?? {}) as Record<string, unknown>;
  const opened = toNumber(summary.opened);
  const closed = toNumber(summary.closed);
  const total = opened + closed;
  return {
    opened,
    closed,
    total,
    openedSharePct: share(opened, total),
    closedSharePct: share(closed, total),
    openedChangeVsPreviousPct: typeof summary.openedPercentage === "number" ? summary.openedPercentage : null,
    closedChangeVsPreviousPct: typeof summary.closedPercentage === "number" ? summary.closedPercentage : null,
  };
}

export interface BreakdownGroup {
  group: string;
  current: number;
  previous: number | null;
  sharePct: number;
  changeVsPreviousPct: number | null;
}

export interface BreakdownComputed {
  total: number;
  previousTotal: number | null;
  changeVsPreviousPct: number | null;
  groups: BreakdownGroup[];
}

export function computeBreakdown(response: unknown): BreakdownComputed {
  const root = (response ?? {}) as {
    summary?: Record<string, unknown>;
    pieData?: Record<string, Record<string, unknown>>;
  };
  const pie = root.pieData ?? {};
  const entries = Object.entries(pie).map(([group, value]) => ({
    group,
    current: toNumber(value?.current),
    previous: typeof value?.prev === "number" ? value.prev : null,
    changeVsPreviousPct: typeof value?.percentage === "number" ? value.percentage : null,
  }));
  const pieTotal = entries.reduce((sum, entry) => sum + entry.current, 0);
  const total = typeof root.summary?.total === "number" ? root.summary.total : pieTotal;

  return {
    total,
    previousTotal: typeof root.summary?.previousTotal === "number" ? root.summary.previousTotal : null,
    changeVsPreviousPct: typeof root.summary?.percentage === "number" ? root.summary.percentage : null,
    groups: entries
      .map((entry) => ({ ...entry, sharePct: share(entry.current, pieTotal) }))
      .sort((a, b) => b.current - a.current),
  };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export interface ToolDeps {
  client: ReportsClient;
  ctx: RequestContext;
}

export function registerConversationTools(server: McpServer, { client, ctx }: ToolDeps): void {
  server.registerTool(
    "get_conversations_summary",
    {
      title: "Conversations summary",
      description:
        "Aggregated conversation metrics for a date range. view=totals returns opened/closed counts, shares and " +
        "change vs previous period (supports filters #1,#3-#6 and is_ai only). view=hourly returns a weekday x hour " +
        "heatmap. view=breakdown groups opened or closed conversations by contactType/source/channel/category " +
        "(top 4 + Other). Requires read-conversation-reports.",
      inputSchema: SummaryInputSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        const request = buildSummaryRequest(input);
        const data = await client.post(request.path, request.body, ctx);
        const computed =
          input.view === "totals" ? computeTotals(data) : input.view === "breakdown" ? computeBreakdown(data) : undefined;
        return toToolResult({
          view: input.view,
          endpoint: request.path,
          ...(request.warnings.length > 0 ? { warnings: request.warnings } : {}),
          ...(computed ? { computed } : {}),
          data,
        });
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    "get_conversations_list",
    {
      title: "Conversations list",
      description:
        "Paginated per-conversation rows (timings, assignees, sources, category) for a date range. Supports all 12 " +
        "conversation filters plus is_ai / is_closed_by_ai. meta.total is the filtered count, so use this tool to " +
        "count conversations when filters #2 or #7-#12 are involved. Requires read-conversation-reports.",
      inputSchema: ListInputSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        const request = buildListRequest(input);
        const response = await client.post<{ data?: { data?: unknown; meta?: unknown; totalRecords?: unknown } }>(
          request.path,
          request.body,
          ctx,
        );
        const payload = response?.data ?? {};
        return toToolResult({
          endpoint: request.path,
          meta: payload.meta ?? null,
          totalRecords: payload.totalRecords ?? null,
          rows: payload.data ?? [],
        });
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    "get_conversations_closed_by_ai",
    {
      title: "Conversations closed by AI",
      description:
        "Conversations assigned to AI and closed by AI in a date range: time-series chart plus totals vs previous " +
        "period. start_date must be strictly before end_date. Requires read-conversation-reports.",
      inputSchema: ClosedByAiInputSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        const request = buildClosedByAiRequest(input);
        const data = await client.post(request.path, request.body, ctx);
        return toToolResult({ endpoint: request.path, data });
      } catch (error) {
        return toToolError(error);
      }
    },
  );
}
