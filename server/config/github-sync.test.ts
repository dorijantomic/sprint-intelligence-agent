import { describe, expect, it, vi } from "vitest";
import {
  readGitHubSyncConfig,
  resolveGitHubToken,
} from "./github-sync.js";

const validEnvironment = {
  GITHUB_PROJECT_OWNER: "acme",
  GITHUB_PROJECT_NUMBER: "7",
  GITHUB_ITERATION_ID: "iteration-42",
};

describe("GitHub sync configuration", () => {
  it("parses a valid environment without exposing the token elsewhere", () => {
    const config = readGitHubSyncConfig(validEnvironment);

    expect(config).toEqual({
      token: null,
      owner: "acme",
      projectNumber: 7,
      iterationId: "iteration-42",
      databasePath: ".data/sprint-intelligence.sqlite",
    });
  });

  it("rejects missing project details and invalid project numbers", () => {
    expect(() =>
      readGitHubSyncConfig({ ...validEnvironment, GITHUB_PROJECT_OWNER: "" }),
    ).toThrow("GITHUB_PROJECT_OWNER");
    expect(() =>
      readGitHubSyncConfig({ ...validEnvironment, GITHUB_PROJECT_NUMBER: "nope" }),
    ).toThrow("positive integer");
  });

  it("prefers an explicitly configured token without invoking GitHub CLI", () => {
    const runGitHubCli = vi.fn(() => "cli-token");

    expect(resolveGitHubToken("configured-token", runGitHubCli)).toBe(
      "configured-token",
    );
    expect(runGitHubCli).not.toHaveBeenCalled();
  });

  it("uses the authenticated GitHub CLI when no token is configured", () => {
    expect(resolveGitHubToken(null, () => "  cli-token\n")).toBe("cli-token");
  });

  it("returns a secret-free setup message when GitHub CLI auth is unavailable", () => {
    expect(() =>
      resolveGitHubToken(null, () => {
        throw new Error("command included sensitive output");
      }),
    ).toThrow("gh auth login");
  });
});
