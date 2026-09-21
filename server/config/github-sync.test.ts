import { describe, expect, it } from "vitest";
import { readGitHubSyncConfig } from "./github-sync.js";

const validEnvironment = {
  GITHUB_TOKEN: "test-token",
  GITHUB_PROJECT_OWNER: "acme",
  GITHUB_PROJECT_NUMBER: "7",
  GITHUB_ITERATION_ID: "iteration-42",
};

describe("GitHub sync configuration", () => {
  it("parses a valid environment without exposing the token elsewhere", () => {
    const config = readGitHubSyncConfig(validEnvironment);

    expect(config).toEqual({
      token: "test-token",
      owner: "acme",
      projectNumber: 7,
      iterationId: "iteration-42",
      databasePath: ".data/sprint-intelligence.sqlite",
    });
  });

  it("rejects missing credentials and invalid project numbers", () => {
    expect(() =>
      readGitHubSyncConfig({ ...validEnvironment, GITHUB_TOKEN: "" }),
    ).toThrow("GITHUB_TOKEN");
    expect(() =>
      readGitHubSyncConfig({ ...validEnvironment, GITHUB_PROJECT_NUMBER: "nope" }),
    ).toThrow("positive integer");
  });
});
