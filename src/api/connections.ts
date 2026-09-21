export interface GitHubIterationOption {
  id: string;
  title: string;
  startDate: string;
  duration: number;
  completed: boolean;
}

export interface GitHubProjectOption {
  id: string;
  owner: string;
  number: number;
  title: string;
  url: string;
  iterations: GitHubIterationOption[];
}

export interface GitHubConnectionConfig {
  owner: string;
  projectNumber: number;
  projectTitle: string;
  projectUrl: string;
  iterationId: string;
  iterationTitle: string;
}

export interface JiraConnectionConfig {
  baseUrl: string;
  authMode?: "api_token" | "oauth";
  email?: string;
  cloudId?: string;
  sprintId: number;
  sprintName: string;
  storyPointField: string | null;
}

export interface AtlassianOAuthStatus {
  configured: boolean;
  connected: boolean;
  missing: string[];
}

export interface AtlassianSite {
  id: string;
  name: string;
  url: string;
}

export interface AtlassianBoard {
  id: number;
  name: string;
  type: string;
  projectKey: string | null;
}

export interface AtlassianSprint {
  id: number;
  name: string;
  state: string;
  startDate: string | null;
  endDate: string | null;
}

export interface AtlassianSprintDiscovery {
  sprints: AtlassianSprint[];
  storyPointField: string | null;
}

export interface GitHubConnection {
  id: number;
  provider: "github";
  externalId: string;
  displayName: string;
  config: GitHubConnectionConfig;
  updatedAt: string;
}

export interface JiraConnection {
  id: number;
  provider: "jira";
  externalId: string;
  displayName: string;
  config: JiraConnectionConfig;
  updatedAt: string;
}

export type Connection = GitHubConnection | JiraConnection;

export interface SyncResult {
  status: "updated" | "unchanged";
  snapshotId: string;
  snapshotCreated: boolean;
  snapshotItems: number;
  summary: {
    durationMs: number;
    requestCount: number;
    items: number;
    eventsAdded: number;
    relationships: number;
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string; kind?: string };
  if (!response.ok) {
    throw new ApiError(
      body.error ?? `Request failed with HTTP ${response.status}`,
      response.status,
      body.kind,
    );
  }
  return body;
}

export async function loadConnections(): Promise<Connection[]> {
  const response = await fetch("/api/connections");
  const body = await readResponse<{ connections: Connection[] }>(response);
  return body.connections;
}

export async function discoverProjects(): Promise<GitHubProjectOption[]> {
  const response = await fetch("/api/github/projects");
  const body = await readResponse<{ projects: GitHubProjectOption[] }>(response);
  return body.projects;
}

export async function saveGitHubConnection(
  config: GitHubConnectionConfig,
): Promise<Connection> {
  const response = await fetch("/api/connections/github", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config),
  });
  const body = await readResponse<{ connection: Connection }>(response);
  return body.connection;
}

export async function saveJiraConnection(
  config: JiraConnectionConfig & { apiToken?: string },
): Promise<JiraConnection> {
  const response = await fetch("/api/connections/jira", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config),
  });
  const body = await readResponse<{ connection: JiraConnection }>(response);
  return body.connection;
}

export async function loadAtlassianOAuthStatus(): Promise<AtlassianOAuthStatus> {
  const response = await fetch("/api/auth/atlassian/status");
  return readResponse<AtlassianOAuthStatus>(response);
}

export async function saveAtlassianOAuthCredentials(
  clientId: string,
  clientSecret: string,
): Promise<AtlassianOAuthStatus> {
  const response = await fetch("/api/auth/atlassian/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  return (await readResponse<{ status: AtlassianOAuthStatus }>(response)).status;
}

export async function loadAtlassianSites(): Promise<AtlassianSite[]> {
  const response = await fetch("/api/atlassian/sites");
  return (await readResponse<{ sites: AtlassianSite[] }>(response)).sites;
}

export async function loadAtlassianBoards(cloudId: string): Promise<AtlassianBoard[]> {
  const response = await fetch(`/api/atlassian/boards?cloudId=${encodeURIComponent(cloudId)}`);
  return (await readResponse<{ boards: AtlassianBoard[] }>(response)).boards;
}

export async function loadAtlassianSprints(
  cloudId: string,
  boardId: number,
): Promise<AtlassianSprintDiscovery> {
  const response = await fetch(
    `/api/atlassian/boards/${boardId}/sprints?cloudId=${encodeURIComponent(cloudId)}`,
  );
  return readResponse<AtlassianSprintDiscovery>(response);
}

export async function saveJiraOAuthConnection(
  config: JiraConnectionConfig & { authMode: "oauth"; cloudId: string },
): Promise<JiraConnection> {
  const response = await fetch("/api/connections/jira/oauth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config),
  });
  return (await readResponse<{ connection: JiraConnection }>(response)).connection;
}

export async function syncConnection(connectionId: number): Promise<SyncResult> {
  const response = await fetch(`/api/connections/${connectionId}/sync`, {
    method: "POST",
  });
  return readResponse<SyncResult>(response);
}
