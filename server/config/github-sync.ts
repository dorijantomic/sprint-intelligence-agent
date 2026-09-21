import { execFileSync } from "node:child_process";

export interface GitHubSyncConfig {
  token: string | null;
  owner: string;
  projectNumber: number;
  iterationId: string;
  databasePath: string;
}

function required(
  environment: NodeJS.ProcessEnv,
  name: keyof NodeJS.ProcessEnv,
): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function readGitHubSyncConfig(
  environment: NodeJS.ProcessEnv,
): GitHubSyncConfig {
  const projectNumberValue = required(environment, "GITHUB_PROJECT_NUMBER");
  const projectNumber = Number(projectNumberValue);
  if (!Number.isSafeInteger(projectNumber) || projectNumber <= 0) {
    throw new Error("GITHUB_PROJECT_NUMBER must be a positive integer");
  }

  return {
    token: environment.GITHUB_TOKEN?.trim() || null,
    owner: required(environment, "GITHUB_PROJECT_OWNER"),
    projectNumber,
    iterationId: required(environment, "GITHUB_ITERATION_ID"),
    databasePath:
      environment.SPRINT_LEDGER_PATH?.trim() ||
      ".data/sprint-intelligence.sqlite",
  };
}

export type GitHubTokenCommand = () => string;

function readTokenFromGitHubCli(): string {
  return execFileSync("gh", ["auth", "token"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function resolveGitHubToken(
  configuredToken: string | null,
  runGitHubCli: GitHubTokenCommand = readTokenFromGitHubCli,
): string {
  if (configuredToken) return configuredToken;

  try {
    const token = runGitHubCli().trim();
    if (token) return token;
  } catch {
    // Replace command details with a stable, secret-free setup message below.
  }

  throw new Error(
    "GitHub authentication is unavailable. Run `gh auth login`, or set GITHUB_TOKEN for CI.",
  );
}
