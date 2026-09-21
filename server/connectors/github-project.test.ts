import { describe, expect, it, vi } from "vitest";
import { GitHubProjectConnector } from "./github-project.js";

const projectResponse = {
  data: {
    repositoryOwner: {
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
                comments: {
                  totalCount: 7,
                  nodes: [
                    {
                      id: "IC_comment",
                      bodyText: "Waiting for the idempotency work.",
                      createdAt: "2026-09-18T09:50:00Z",
                      updatedAt: "2026-09-18T09:50:00Z",
                      url: "https://github.com/acme/checkout/issues/142#issuecomment-1",
                      author: { login: "maya" },
                    },
                  ],
                },
                blockedBy: {
                  nodes: [
                    {
                      id: "I_blocker",
                      number: 139,
                      title: "Expose idempotency keys",
                      url: "https://github.com/acme/checkout/issues/139",
                      updatedAt: "2026-09-18T09:28:00Z",
                      state: "OPEN",
                      assignees: { nodes: [{ login: "leo" }] },
                      comments: { totalCount: 3 },
                      repository: { nameWithOwner: "acme/checkout" },
                    },
                  ],
                },
                repository: { nameWithOwner: "acme/checkout" },
              },
            },
            {
              id: "PVTI_pull_request",
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
                  { name: "In review", field: { name: "Status" } },
                ],
              },
              content: {
                id: "PR_review",
                number: 144,
                title: "Harden payment retries",
                url: "https://github.com/acme/checkout/pull/144",
                updatedAt: "2026-09-18T12:00:00Z",
                state: "OPEN",
                reviewDecision: "CHANGES_REQUESTED",
                assignees: { nodes: [{ login: "leo" }] },
                comments: { totalCount: 1, nodes: [] },
                reviews: {
                  nodes: [
                    {
                      id: "PRR_review",
                      bodyText: "Please cover the timeout path.",
                      submittedAt: "2026-09-18T11:45:00Z",
                      updatedAt: "2026-09-18T11:45:00Z",
                      url: "https://github.com/acme/checkout/pull/144#pullrequestreview-1",
                      state: "CHANGES_REQUESTED",
                      author: { login: "iris" },
                    },
                  ],
                },
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
                comments: { totalCount: 0, nodes: [] },
                blockedBy: { nodes: [] },
                repository: { nameWithOwner: "acme/checkout" },
              },
            },
          ],
        },
      },
    },
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
    expect(batches[0].items).toHaveLength(3);
    expect(batches[0].items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalId: "I_issue",
          key: "acme/checkout#142",
          status: "in_progress",
          priority: "high",
          assignee: "maya",
          estimate: 8,
          commentCount: 7,
          reviewState: "none",
        }),
        expect.objectContaining({
          externalId: "I_blocker",
          iterationExternalId: null,
          key: "acme/checkout#139",
          status: "open",
        }),
        expect.objectContaining({
          externalId: "PR_review",
          key: "acme/checkout#144",
          status: "in_review",
          reviewState: "changes_requested",
        }),
      ]),
    );
    expect(batches[0].relationships).toEqual([
      expect.objectContaining({
        fromExternalId: "I_issue",
        toExternalId: "I_blocker",
        kind: "blocked_by",
      }),
    ]);
    expect(batches[0].relationshipResets).toEqual([
      { fromExternalId: "I_issue", kind: "blocked_by" },
      { fromExternalId: "PR_review", kind: "blocked_by" },
    ]);
    expect(batches[0].events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalId: "I_issue:2026-09-18T10:05:00Z",
          kind: "observed_update",
        }),
        expect.objectContaining({
          externalId: "IC_comment",
          kind: "commented",
          actor: "maya",
        }),
        expect.objectContaining({
          externalId: "PRR_review",
          kind: "reviewed",
          actor: "iris",
          payload: expect.objectContaining({ state: "changes_requested" }),
        }),
      ]),
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
