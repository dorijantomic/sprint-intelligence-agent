import { randomBytes, timingSafeEqual } from "node:crypto";
import { SourceSecretStore } from "../config/source-secrets.js";

const GRANT_KEY = "atlassian:oauth:grant";
const STATE_KEY = "atlassian:oauth:state";
const DEFAULT_SCOPES = [
  "offline_access",
  "read:jira-work",
  "read:jira-user",
  "read:board-scope:jira-software",
  "read:board-scope.admin:jira-software",
  "read:project:jira",
  "read:sprint:jira-software",
  "read:issue-details:jira",
  "read:jql:jira",
].join(" ");

export interface AtlassianSite {
  id: string;
  name: string;
  url: string;
  avatarUrl?: string;
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

export interface AtlassianOAuthStatus {
  configured: boolean;
  connected: boolean;
  missing: string[];
}

export interface AtlassianOAuthProvider {
  readonly appUrl?: string;
  status(): Promise<AtlassianOAuthStatus>;
  authorizationUrl(): Promise<string>;
  complete(code: string, state: string): Promise<void>;
  getAccessToken(): Promise<string>;
  listSites(): Promise<AtlassianSite[]>;
  listBoards(cloudId: string): Promise<AtlassianBoard[]>;
  listSprints(cloudId: string, boardId: number): Promise<AtlassianSprintDiscovery>;
}

interface OAuthGrant {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scopes: string;
}

interface OAuthState {
  value: string;
  expiresAt: number;
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

export interface AtlassianOAuthOptions {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  appUrl?: string;
  scopes?: string;
  secrets?: SourceSecretStore;
  request?: typeof fetch;
  now?: () => number;
}

export class AtlassianOAuthError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
    this.name = "AtlassianOAuthError";
  }
}

function requiredPositiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return parsed;
}

export class AtlassianOAuth implements AtlassianOAuthProvider {
  readonly appUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly scopes: string;
  private readonly secrets: SourceSecretStore;
  private readonly request: typeof fetch;
  private readonly now: () => number;
  private refreshPromise: Promise<string> | null = null;

  constructor(options: AtlassianOAuthOptions = {}) {
    this.clientId = options.clientId ?? process.env.ATLASSIAN_CLIENT_ID ?? "";
    this.clientSecret = options.clientSecret ?? process.env.ATLASSIAN_CLIENT_SECRET ?? "";
    this.redirectUri = options.redirectUri ?? process.env.ATLASSIAN_REDIRECT_URI ??
      "http://localhost:8787/api/auth/atlassian/callback";
    this.appUrl = (options.appUrl ?? process.env.ATLASSIAN_APP_URL ?? process.env.APP_URL ??
      "http://localhost:5173").replace(/\/$/, "");
    this.scopes = options.scopes ?? process.env.ATLASSIAN_SCOPES ?? DEFAULT_SCOPES;
    this.secrets = options.secrets ?? new SourceSecretStore();
    this.request = options.request ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async status(): Promise<AtlassianOAuthStatus> {
    const missing = [
      !this.clientId ? "ATLASSIAN_CLIENT_ID" : null,
      !this.clientSecret ? "ATLASSIAN_CLIENT_SECRET" : null,
    ].filter((value): value is string => value !== null);
    return {
      configured: missing.length === 0,
      connected: missing.length === 0 && Boolean(await this.readGrant()),
      missing,
    };
  }

  async authorizationUrl(): Promise<string> {
    this.assertConfigured();
    const state = randomBytes(32).toString("base64url");
    await this.secrets.set(STATE_KEY, JSON.stringify({
      value: state,
      expiresAt: this.now() + 10 * 60_000,
    } satisfies OAuthState));
    const url = new URL("https://auth.atlassian.com/authorize");
    url.search = new URLSearchParams({
      audience: "api.atlassian.com",
      client_id: this.clientId,
      scope: this.scopes,
      redirect_uri: this.redirectUri,
      state,
      response_type: "code",
      prompt: "consent",
    }).toString();
    return url.toString();
  }

  async complete(code: string, state: string): Promise<void> {
    this.assertConfigured();
    const stored = await this.readJson<OAuthState>(STATE_KEY);
    if (!stored || stored.expiresAt < this.now()) {
      await this.secrets.delete(STATE_KEY);
      throw new AtlassianOAuthError("The Atlassian authorization session is invalid or expired", 400);
    }
    if (!secureEqual(stored.value, state)) {
      throw new AtlassianOAuthError("The Atlassian authorization session is invalid or expired", 400);
    }
    await this.secrets.delete(STATE_KEY);
    const token = await this.tokenRequest({
      grant_type: "authorization_code",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: this.redirectUri,
    });
    await this.writeGrant(token, token.refresh_token ?? null);
  }

  async getAccessToken(): Promise<string> {
    const grant = await this.readGrant();
    if (!grant) throw new AtlassianOAuthError("Connect Atlassian before synchronizing", 401);
    if (grant.expiresAt > this.now() + 60_000) return grant.accessToken;
    if (!grant.refreshToken) {
      throw new AtlassianOAuthError("Atlassian access expired; reconnect Atlassian", 401);
    }
    if (!this.refreshPromise) {
      this.refreshPromise = this.refresh(grant).finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  async listSites(): Promise<AtlassianSite[]> {
    const response = await this.authorizedGet("https://api.atlassian.com/oauth/token/accessible-resources");
    const sites = await response.json() as Array<{
      id: string;
      name: string;
      url: string;
      avatarUrl?: string;
    }>;
    return sites.map(({ id, name, url, avatarUrl }) => ({ id, name, url, avatarUrl }));
  }

  async listBoards(cloudId: string): Promise<AtlassianBoard[]> {
    const boards: AtlassianBoard[] = [];
    let startAt = 0;
    while (true) {
      const url = this.jiraUrl(cloudId, "/rest/agile/1.0/board");
      url.search = new URLSearchParams({ startAt: String(startAt), maxResults: "50" }).toString();
      const response = await this.authorizedGet(url.toString());
      const page = await response.json() as {
        values?: Array<{ id: number; name: string; type?: string; location?: { projectKey?: string } }>;
        isLast?: boolean;
        maxResults?: number;
      };
      const values = page.values ?? [];
      boards.push(...values.map((board) => ({
        id: board.id,
        name: board.name,
        type: board.type ?? "unknown",
        projectKey: board.location?.projectKey ?? null,
      })));
      if (page.isLast === true || values.length === 0) break;
      startAt += page.maxResults ?? values.length;
    }
    return boards;
  }

  async listSprints(cloudId: string, boardId: number): Promise<AtlassianSprintDiscovery> {
    requiredPositiveInteger(boardId, "boardId");
    const sprintResponse = await this.authorizedGet(this.jiraUrl(
      cloudId,
      `/rest/agile/1.0/board/${boardId}/sprint?state=active,future&maxResults=50`,
    ).toString());
    const sprintPage = await sprintResponse.json() as {
      values?: Array<{
        id: number;
        name: string;
        state?: string;
        startDate?: string;
        endDate?: string;
      }>;
    };
    let storyPointField: string | null = null;
    try {
      const configResponse = await this.authorizedGet(this.jiraUrl(
        cloudId,
        `/rest/agile/1.0/board/${boardId}/configuration`,
      ).toString());
      const config = await configResponse.json() as {
        estimation?: { field?: { fieldId?: string } };
      };
      storyPointField = config.estimation?.field?.fieldId ?? null;
    } catch (error) {
      if (!(error instanceof AtlassianOAuthError) || ![403, 404].includes(error.status)) {
        throw error;
      }
    }
    return {
      sprints: (sprintPage.values ?? []).map((sprint) => ({
        id: sprint.id,
        name: sprint.name,
        state: sprint.state ?? "unknown",
        startDate: sprint.startDate ?? null,
        endDate: sprint.endDate ?? null,
      })),
      storyPointField,
    };
  }

  private assertConfigured(): void {
    if (!this.clientId || !this.clientSecret) {
      throw new AtlassianOAuthError(
        "Atlassian OAuth is not configured. Set ATLASSIAN_CLIENT_ID and ATLASSIAN_CLIENT_SECRET.",
        503,
      );
    }
  }

  private jiraUrl(cloudId: string, path: string): URL {
    if (!cloudId.trim()) throw new Error("cloudId is required");
    return new URL(`https://api.atlassian.com/ex/jira/${encodeURIComponent(cloudId)}${path}`);
  }

  private async authorizedGet(url: string): Promise<Response> {
    const response = await this.request(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${await this.getAccessToken()}`,
      },
    });
    if (!response.ok) {
      throw new AtlassianOAuthError(
        `Atlassian request failed with HTTP ${response.status}`,
        response.status,
      );
    }
    return response;
  }

  private async refresh(grant: OAuthGrant): Promise<string> {
    this.assertConfigured();
    let token: OAuthTokenResponse;
    try {
      token = await this.tokenRequest({
        grant_type: "refresh_token",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: grant.refreshToken,
      });
    } catch (error) {
      if (error instanceof AtlassianOAuthError && [400, 401].includes(error.status)) {
        await this.secrets.delete(GRANT_KEY);
        throw new AtlassianOAuthError("Atlassian access expired; reconnect Atlassian", 401);
      }
      throw error;
    }
    const refreshToken = token.refresh_token ?? grant.refreshToken;
    await this.writeGrant(token, refreshToken);
    return token.access_token;
  }

  private async tokenRequest(body: Record<string, string | null>): Promise<OAuthTokenResponse> {
    const response = await this.request("https://auth.atlassian.com/oauth/token", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new AtlassianOAuthError(
        `Atlassian token exchange failed with HTTP ${response.status}`,
        response.status,
      );
    }
    const token = await response.json() as OAuthTokenResponse;
    if (!token.access_token || !Number.isFinite(token.expires_in)) {
      throw new AtlassianOAuthError("Atlassian returned an invalid token response", 502);
    }
    return token;
  }

  private async writeGrant(token: OAuthTokenResponse, refreshToken: string | null): Promise<void> {
    await this.secrets.set(GRANT_KEY, JSON.stringify({
      accessToken: token.access_token,
      refreshToken,
      expiresAt: this.now() + token.expires_in * 1_000,
      scopes: token.scope ?? this.scopes,
    } satisfies OAuthGrant));
  }

  private async readGrant(): Promise<OAuthGrant | null> {
    return this.readJson<OAuthGrant>(GRANT_KEY);
  }

  private async readJson<T>(key: string): Promise<T | null> {
    const raw = await this.secrets.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new AtlassianOAuthError("The local Atlassian credential store is invalid", 500);
    }
  }
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
