import { describe, expect, it, vi } from "vitest";
import { GitHubProjectConnector } from "./github-project.js";

const projectResponse = {
  data: {
    organization: {
      projectV2: {
        id: "PVT_project",
        title: "Checkout reliability",
        shortDescription: "Stabilize the payment path",
        items: {
          pageInfo: { hasNextPage: false, endCursor: "page-1" },
          nodes: [
            {
              id: "PVTI_item",
              isArchived: false,
              fieldValues: {
                nodes: [
                  {
                    iterationId: "iteration-42",
                    title: "Sprint 42",
                    startDate: "2026-09-14",
                    duration: 12,
                    field: { name: "Iteration" },
                  },
                  { name: "In progress", field: { name: "Status" } },
                  { name: "High", field: { name: "Priority" } },
                  { number: 8, field: { name: "Estimate" } },
                ],
              },
              content: {
                id: "I_issue",
                number: 142,
                title: "Retry payment authorization",
                url: "https://github.com/acme/checkout/issues/142",
                updatedAt: "2026-09-18T10:05:00Z",
                state: "OPEN",
                assignees: { nodes: [{ login: "maya" }] },
                repository: { nameWithOwner: "acme/checkout" },
              },
            },
            {
              id: "PVTI_other_iteration",
              isArchived: false,
              fieldValues: {
                nodes: [
                  {
                    iterationId: "iteration-43",
                    title: "Sprint 43",
                    startDate: "2026-09-28",
                    duration: 12,
                    field: { name: "Iteration" },
                  },
                ],
              },
              content: {
                id: "I_future",
                number: 150,
                title: "Future work",
                url: "https://github.com/acme/checkout/issues/150",
                updatedAt: "2026-09-18T11:00:00Z",
                state: "OPEN",
                assignees: { nodes: [] },
                repository: { nameWithOwner: "acme/checkout" },
              },
            },
          ],
        },
      },
    },
    user: null,
  },
};

describe("GitHubProjectConnector", () => {
  it("normalizes only items from the configured iteration", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(projectResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const connector = new GitHubProjectConnector({
      owner: "acme",
      projectNumber: 7,
      iterationId: "iteration-42",
      token: "not-a-real-token",
      fetch: request,
    });

    const batches = [];
    for await (const batch of connector.pull(null)) batches.push(batch);

    expect(batches).toHaveLength(1);
    expect(batches[0].iteration).toMatchObject({
      externalId: "iteration-42",
      name: "Sprint 42",
      startsAt: "2026-09-14",
      endsAt: "2026-09-26",
    });
    expect(batches[0].items).toEqual([
      expect.objectContaining({
        externalId: "I_issue",
        key: "acme/checkout#142",
        status: "in_progress",
        priority: "high",
        assignee: "maya",
        estimate: 8,
      }),
    ]);
    expect(batches[0].events[0].externalId).toBe(
      "I_issue:2026-09-18T10:05:00Z",
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("does not expose the token in the connection identity", () => {
    const connector = new GitHubProjectConnector({
      owner: "dorijantomic",
      projectNumber: 1,
      iterationId: "iteration-1",
      token: "secret-token",
      fetch: vi.fn<typeof fetch>(),
    });

    expect(connector.connectionExternalId).toBe("dorijantomic/projects/1");
    expect(connector.connectionExternalId).not.toContain("secret-token");
  });
});
