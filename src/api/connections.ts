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

export interface Connection {
  id: number;
  provider: "github";
  externalId: string;
  displayName: string;
  config: GitHubConnectionConfig;
  updatedAt: string;
}

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

export async function syncConnection(connectionId: number): Promise<SyncResult> {
  const response = await fetch(`/api/connections/${connectionId}/sync`, {
    method: "POST",
  });
  return readResponse<SyncResult>(response);
}
