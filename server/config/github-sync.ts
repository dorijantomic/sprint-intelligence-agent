export interface GitHubSyncConfig {
  token: string;
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
    token: required(environment, "GITHUB_TOKEN"),
    owner: required(environment, "GITHUB_PROJECT_OWNER"),
    projectNumber,
    iterationId: required(environment, "GITHUB_ITERATION_ID"),
    databasePath:
      environment.SPRINT_LEDGER_PATH?.trim() ||
      ".data/sprint-intelligence.sqlite",
  };
}
