import { describe, expect, it, vi } from "vitest";
import {
  discoverGitHubProjects,
  GitHubApiError,
} from "./github-discovery.js";

describe("discoverGitHubProjects", () => {
  it("returns personal and organization projects with active and completed iterations", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            viewer: {
              login: "maya",
              projectsV2: {
                nodes: [
                  {
                    id: "PVT_personal",
                    number: 1,
                    title: "Delivery",
                    url: "https://github.com/users/maya/projects/1",
                    fields: {
                      nodes: [
                        {
                          configuration: {
                            iterations: [
                              {
                                id: "iteration-2",
                                title: "Sprint 2",
                                startDate: "2026-09-21",
                                duration: 14,
                              },
                            ],
                            completedIterations: [
                              {
                                id: "iteration-1",
                                title: "Sprint 1",
                                startDate: "2026-09-07",
                                duration: 14,
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
              organizations: {
                nodes: [
                  {
                    login: "acme",
                    projectsV2: {
                      nodes: [
                        {
                          id: "PVT_org",
                          number: 7,
                          title: "Checkout",
                          url: "https://github.com/orgs/acme/projects/7",
                          fields: { nodes: [] },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        }),
        { status: 200 },
      ),
    );

    const projects = await discoverGitHubProjects("secret", request);

    expect(projects).toEqual([
      expect.objectContaining({
        owner: "maya",
        number: 1,
        iterations: [
          expect.objectContaining({ id: "iteration-2", completed: false }),
          expect.objectContaining({ id: "iteration-1", completed: true }),
        ],
      }),
      expect.objectContaining({ owner: "acme", number: 7, iterations: [] }),
    ]);
    expect(request).toHaveBeenCalledOnce();
    const init = request.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual(
      expect.objectContaining({ authorization: "Bearer secret" }),
    );
  });

  it("classifies rejected credentials as an authentication error", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("unauthorized", { status: 401 }),
    );

    await expect(discoverGitHubProjects("bad-token", request)).rejects.toEqual(
      expect.objectContaining<Partial<GitHubApiError>>({
        kind: "authentication",
      }),
    );
  });
});
