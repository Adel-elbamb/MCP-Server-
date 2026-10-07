import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ValidationError } from "../src/common/errors/index.js";
import {
  ALLOWED_FILTERS,
  buildClosedByAiRequest,
  buildListRequest,
  buildSummaryRequest,
  computeBreakdown,
  computeTotals,
  CONVERSATION_PATHS,
  DEFAULT_LIST_COLUMNS,
  ListInputSchema,
  mapConversationFilters,
  SummaryInputSchema,
} from "../src/mcp/tools/reports/conversations.tool.js";

const RANGE = { start_date: "2026-09-01T00:00:00Z", end_date: "2026-09-30T23:59:59Z" };

describe("mapConversationFilters", () => {
  it("maps every snake_case filter to its API field", () => {
    const { body, dropped } = mapConversationFilters(
      {
        conversation_opened_source: ["User"],
        conversation_closed_source: ["System"],
        contact_type: ["New"],
        conversation_opened_channel: ["ch-1"],
        contact: ["c-1"],
        conversation_id: [226473],
        first_assignee: ["u-1"],
        last_assignee: ["none"],
        first_response_by: ["u-2"],
        closed_by_team: ["t-1"],
        closed_by_user: ["u-3"],
        conversation_category: ["cat-1"],
        is_ai: true,
        is_closed_by_ai: false,
      },
      ALLOWED_FILTERS.list,
    );

    assert.deepEqual(dropped, []);
    assert.deepEqual(body, {
      conversationOpenedBySource: ["User"],
      conversationClosedBySource: ["System"],
      conversationContactType: ["New"],
      conversationChannel: ["ch-1"],
      conversationContact: ["c-1"],
      conversationIds: [226473],
      firstAssignee: ["u-1"],
      lastAssignee: ["none"],
      firstResponseBy: ["u-2"],
      closedByTeam: ["t-1"],
      closedByUser: ["u-3"],
      conversationCategory: ["cat-1"],
      isAi: true,
      isClosedByAi: false,
    });
  });

  it("drops filters the endpoint does not allow and skips empty values", () => {
    const { body, dropped } = mapConversationFilters(
      { contact_type: ["Returning"], closed_by_team: ["t-1"], first_assignee: [], contact: undefined },
      ALLOWED_FILTERS.overview,
    );
    assert.deepEqual(body, { conversationContactType: ["Returning"] });
    assert.deepEqual(dropped, ["closed_by_team"]);
  });
});

describe("buildSummaryRequest", () => {
  it("view=totals -> overview, never sends filters #2/#7-#12", () => {
    const input = SummaryInputSchema.parse({
      view: "totals",
      ...RANGE,
      closed_by_team: ["t-1"],
      first_assignee: ["u-1"],
      contact_type: ["New"],
      is_ai: true,
    });
    const request = buildSummaryRequest(input);

    assert.equal(request.path, CONVERSATION_PATHS.overview);
    assert.deepEqual(request.body, {
      startDate: RANGE.start_date,
      endDate: RANGE.end_date,
      conversationContactType: ["New"],
      isAi: true,
    });
    assert.ok(!("closedByTeam" in request.body));
    assert.ok(!("status" in request.body));
    assert.match(request.warnings.join(" "), /closed_by_team/);
  });

  it("view=totals forwards include_comparison only when given", () => {
    const withFlag = buildSummaryRequest(SummaryInputSchema.parse({ view: "totals", ...RANGE, include_comparison: false }));
    assert.equal(withFlag.body.includeComparison, false);
    const withoutFlag = buildSummaryRequest(SummaryInputSchema.parse({ view: "totals", ...RANGE }));
    assert.ok(!("includeComparison" in withoutFlag.body));
  });

  it("view=hourly -> heatmap with default status, no includeComparison/groupBy", () => {
    const request = buildSummaryRequest(
      SummaryInputSchema.parse({
        view: "hourly",
        ...RANGE,
        include_comparison: true,
        group_by: "channel",
        closed_by_user: ["u-9"],
      }),
    );
    assert.equal(request.path, CONVERSATION_PATHS.heatmap);
    assert.deepEqual(request.body, {
      startDate: RANGE.start_date,
      endDate: RANGE.end_date,
      status: "Opened",
      closedByUser: ["u-9"],
    });
    assert.equal(request.warnings.length, 2);
  });

  it("view=breakdown -> opened-closed with groupBy, drops ignored filters when status=Opened", () => {
    const request = buildSummaryRequest(
      SummaryInputSchema.parse({ view: "breakdown", ...RANGE, group_by: "channel", last_assignee: ["u-1"] }),
    );
    assert.equal(request.path, CONVERSATION_PATHS.openedClosed);
    assert.deepEqual(request.body, {
      startDate: RANGE.start_date,
      endDate: RANGE.end_date,
      status: "Opened",
      groupBy: "channel",
    });
    assert.match(request.warnings.join(" "), /last_assignee/);
  });

  it("view=breakdown with status=Closed sends all 12 filters", () => {
    const request = buildSummaryRequest(
      SummaryInputSchema.parse({ view: "breakdown", ...RANGE, status: "Closed", last_assignee: ["u-1"] }),
    );
    assert.equal(request.body.groupBy, "contactType");
    assert.deepEqual(request.body.lastAssignee, ["u-1"]);
    assert.deepEqual(request.warnings, []);
  });

  it("rejects start_date after end_date", () => {
    const input = SummaryInputSchema.parse({ view: "totals", start_date: RANGE.end_date, end_date: RANGE.start_date });
    assert.throws(() => buildSummaryRequest(input), ValidationError);
  });
});

describe("input schemas", () => {
  it("rejects non-ISO dates and unknown enum values", () => {
    assert.equal(SummaryInputSchema.safeParse({ view: "totals", start_date: "01/09/2026", end_date: RANGE.end_date }).success, false);
    assert.equal(SummaryInputSchema.safeParse({ view: "totals", ...RANGE, contact_type: ["Old"] }).success, false);
    assert.equal(SummaryInputSchema.safeParse({ view: "weekly", ...RANGE }).success, false);
  });

  it("enforces list limit 5-100 and the sort whitelist", () => {
    assert.equal(ListInputSchema.safeParse({ ...RANGE, limit: 3 }).success, false);
    assert.equal(ListInputSchema.safeParse({ ...RANGE, limit: 101 }).success, false);
    assert.equal(ListInputSchema.safeParse({ ...RANGE, sort: "-contactName" }).success, false);
    assert.equal(ListInputSchema.safeParse({ ...RANGE, sort: "-resolutionTime" }).success, true);
  });
});

describe("buildListRequest", () => {
  it("applies defaults and PII-free default columns", () => {
    const request = buildListRequest(ListInputSchema.parse({ ...RANGE }));
    assert.equal(request.path, CONVERSATION_PATHS.list);
    assert.deepEqual(request.body, {
      startDate: RANGE.start_date,
      endDate: RANGE.end_date,
      status: "Closed",
      page: 1,
      limit: 10,
      sort: "-openedTimestamp",
      columns: [...DEFAULT_LIST_COLUMNS],
    });
    assert.ok(!(request.body.columns as string[]).includes("contact"));
  });

  it("passes all filters plus is_closed_by_ai", () => {
    const request = buildListRequest(
      ListInputSchema.parse({ ...RANGE, closed_by_team: ["none"], is_closed_by_ai: true, columns: ["visibleId"] }),
    );
    assert.deepEqual(request.body.closedByTeam, ["none"]);
    assert.equal(request.body.isClosedByAi, true);
    assert.deepEqual(request.body.columns, ["visibleId"]);
  });
});

describe("buildClosedByAiRequest", () => {
  it("requires start strictly before end", () => {
    assert.throws(
      () => buildClosedByAiRequest({ start_date: RANGE.start_date, end_date: RANGE.start_date }),
      ValidationError,
    );
    const request = buildClosedByAiRequest(RANGE);
    assert.deepEqual(request.body, { startDate: RANGE.start_date, endDate: RANGE.end_date });
  });
});

describe("computed values", () => {
  it("computeTotals derives shares; API percentages are kept as change vs previous", () => {
    const computed = computeTotals({
      data: { summary: { opened: 30, closed: 10, openedPercentage: 50, closedPercentage: -20 } },
    });
    assert.deepEqual(computed, {
      opened: 30,
      closed: 10,
      total: 40,
      openedSharePct: 75,
      closedSharePct: 25,
      openedChangeVsPreviousPct: 50,
      closedChangeVsPreviousPct: -20,
    });
  });

  it("computeTotals handles an empty period", () => {
    const computed = computeTotals({ data: { summary: { opened: 0, closed: 0 } } });
    assert.equal(computed.total, 0);
    assert.equal(computed.openedSharePct, 0);
    assert.equal(computed.openedChangeVsPreviousPct, null);
  });

  it("computeBreakdown computes shares from pieData current values, sorted desc", () => {
    const computed = computeBreakdown({
      summary: { total: 100, previousTotal: 80, percentage: 25 },
      pieData: {
        Returning: { current: 25, prev: 30, percentage: -16.67 },
        New: { current: 75, prev: 50, percentage: 50 },
      },
    });
    assert.equal(computed.total, 100);
    assert.equal(computed.previousTotal, 80);
    assert.deepEqual(
      computed.groups.map((g) => [g.group, g.sharePct, g.changeVsPreviousPct]),
      [
        ["New", 75, 50],
        ["Returning", 25, -16.67],
      ],
    );
  });
});
