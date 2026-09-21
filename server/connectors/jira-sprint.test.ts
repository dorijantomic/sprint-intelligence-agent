import { describe, expect, it, vi } from "vitest";
import { JiraSprintConnector } from "./jira-sprint.js";

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("JiraSprintConnector", () => {
  it("normalizes sprint work, comments, and blocker links", async () => {
    const request = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      expect((init?.headers as Record<string, string>).authorization).toMatch(/^Basic /);
      if (url.endsWith("/rest/agile/1.0/sprint/42")) {
        return json({
          id: 42,
          name: "Platform Sprint 9",
          goal: "Ship safer releases",
          startDate: "2026-09-14T09:00:00.000Z",
          endDate: "2026-09-28T09:00:00.000Z",
        });
      }
      if (url.includes("/rest/agile/1.0/sprint/42/issue?")) {
        return json({
          startAt: 0,
          maxResults: 50,
          total: 1,
          issues: [{
            id: "10001",
            key: "ORB-7",
            fields: {
              summary: "Make deploy idempotent",
              status: { name: "In Progress" },
              priority: { name: "High" },
              assignee: { displayName: "Ada" },
              updated: "2026-09-21T08:00:00.000Z",
              comment: { total: 1 },
              customfield_10016: 5,
              issuelinks: [{
                id: "9001",
                type: { inward: "is blocked by", outward: "blocks" },
                inwardIssue: {
                  id: "10000",
                  key: "ORB-6",
                  fields: {
                    summary: "Provision staging",
                    status: { name: "To Do" },
                    priority: { name: "Highest" },
                    updated: "2026-09-20T08:00:00.000Z",
                  },
                },
              }],
            },
          }],
        });
      }
      if (url.includes("/rest/api/3/issue/ORB-7/comment")) {
        return json({
          startAt: 0,
          maxResults: 100,
          total: 1,
          comments: [{
            id: "7001",
            author: { displayName: "Grace" },
            created: "2026-09-21T09:00:00.000Z",
            body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Staging is still unavailable" }] }] },
          }],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const connector = new JiraSprintConnector({
      baseUrl: "https://example.atlassian.net/",
      email: "engineer@example.com",
      apiToken: "secret",
      sprintId: 42,
      fetch: request,
    });

    const batches = [];
    for await (const batch of connector.pull(null)) batches.push(batch);

    expect(batches).toHaveLength(1);
    expect(batches[0].iteration).toEqual(expect.objectContaining({
      externalId: "42",
      name: "Platform Sprint 9",
    }));
    expect(batches[0].items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "ORB-7", estimate: 5, status: "in_progress" }),
      expect.objectContaining({ key: "ORB-6", iterationExternalId: null }),
    ]));
    expect(batches[0].relationships).toContainEqual(expect.objectContaining({
      fromExternalId: "10001",
      toExternalId: "10000",
      kind: "blocked_by",
    }));
    expect(batches[0].events).toContainEqual(expect.objectContaining({
      externalId: "jira-comment:7001",
      actor: "Grace",
      payload: expect.objectContaining({ body: "Staging is still unavailable" }),
    }));
    expect(connector.requestCount).toBe(3);
  });
});
