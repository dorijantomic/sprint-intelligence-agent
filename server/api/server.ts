import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { resolveGitHubToken } from "../config/github-sync.js";
import { SourceSecretStore } from "../config/source-secrets.js";
import {
  AtlassianOAuth,
  AtlassianOAuthError,
  type AtlassianOAuthProvider,
} from "../auth/atlassian-oauth.js";
import { runSprintAgent } from "../agent/run-agent.js";
import type { AgentAnswer } from "../agent/types.js";
import {
  getPublicAgentConfig,
  resolveAgentRuntime,
} from "../agent/runtime/config.js";
import { AgentConfigStore, publicAgentConfig } from "../agent/runtime/settings.js";
import {
  discoverGitHubProjects,
  GitHubApiError,
  type GitHubProjectOption,
} from "../connectors/github-discovery.js";
import { JiraApiError } from "../connectors/jira-sprint.js";
import { runEvaluationSuite } from "../evals/evaluate.js";
import { SprintLedger } from "../ledger/ledger.js";
import {
  syncGitHubConnection,
  type GitHubConnectionConfig,
  type GitHubConnectionSyncResult,
} from "../sync/github-connection.js";
import {
  syncJiraConnection,
  type JiraConnectionConfig,
  type JiraCredential,
  type JiraConnectionSyncResult,
} from "../sync/jira-connection.js";
import { serializeSnapshot } from "./dashboard.js";

type TokenResolver = () => string;
type ProjectDiscovery = (token: string) => Promise<GitHubProjectOption[]>;
type ConnectionSync = (
  ledger: SprintLedger,
  config: GitHubConnectionConfig,
  token: string,
) => Promise<GitHubConnectionSyncResult>;
type JiraConnectionSync = (
  ledger: SprintLedger,
  config: JiraConnectionConfig,
  credential: JiraCredential,
) => Promise<JiraConnectionSyncResult>;
type AskAgent = (
  ledger: SprintLedger,
  question: string,
  since: string | null,
) => Promise<AgentAnswer>;

export interface ApiServerOptions {
  resolveToken?: TokenResolver;
  discoverProjects?: ProjectDiscovery;
  syncConnection?: ConnectionSync;
  syncJiraConnection?: JiraConnectionSync;
  askAgent?: AskAgent;
  agentConfigStore?: AgentConfigStore;
  sourceSecretStore?: SourceSecretStore;
  atlassianOAuth?: AtlassianOAuthProvider;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function sendRedirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { location, "cache-control": "no-store" });
  response.end();
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function requiredString(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function parseJiraConnectionConfig(body: unknown): {
  config: JiraConnectionConfig;
  apiToken: string | null;
} {
  if (!body || typeof body !== "object") {
    throw new Error("A Jira connection is required");
  }
  const input = body as Record<string, unknown>;
  const sprintId = Number(input.sprintId);
  if (!Number.isSafeInteger(sprintId) || sprintId <= 0) {
    throw new Error("sprintId must be a positive integer");
  }
  const parsedUrl = new URL(requiredString(input.baseUrl, "baseUrl"));
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("baseUrl must use HTTP or HTTPS");
  }
  const baseUrl = parsedUrl.toString().replace(/\/$/, "");
  const storyPointField = typeof input.storyPointField === "string"
    ? input.storyPointField.trim() || null
    : null;
  return {
    config: {
      baseUrl,
      authMode: "api_token",
      email: requiredString(input.email, "email"),
      sprintId,
      sprintName: requiredString(input.sprintName, "sprintName"),
      storyPointField,
    },
    apiToken: typeof input.apiToken === "string" && input.apiToken.trim()
      ? input.apiToken.trim()
      : null,
  };
}

function parseJiraOAuthConnectionConfig(body: unknown): JiraConnectionConfig {
  if (!body || typeof body !== "object") {
    throw new Error("A Jira connection is required");
  }
  const input = body as Record<string, unknown>;
  const sprintId = Number(input.sprintId);
  if (!Number.isSafeInteger(sprintId) || sprintId <= 0) {
    throw new Error("sprintId must be a positive integer");
  }
  const parsedUrl = new URL(requiredString(input.baseUrl, "baseUrl"));
  if (parsedUrl.protocol !== "https:") throw new Error("baseUrl must use HTTPS");
  return {
    authMode: "oauth",
    cloudId: requiredString(input.cloudId, "cloudId"),
    baseUrl: parsedUrl.toString().replace(/\/$/, ""),
    sprintId,
    sprintName: requiredString(input.sprintName, "sprintName"),
    storyPointField: typeof input.storyPointField === "string"
      ? input.storyPointField.trim() || null
      : null,
  };
}

function jiraSecretKey(externalId: string): string {
  return `jira:${externalId}`;
}

function parseGitHubConnectionConfig(body: unknown): GitHubConnectionConfig {
  if (!body || typeof body !== "object") {
    throw new Error("A GitHub connection is required");
  }
  const input = body as Record<string, unknown>;
  const projectNumber = Number(input.projectNumber);
  if (!Number.isSafeInteger(projectNumber) || projectNumber <= 0) {
    throw new Error("projectNumber must be a positive integer");
  }

  return {
    owner: requiredString(input.owner, "owner"),
    projectNumber,
    projectTitle: requiredString(input.projectTitle, "projectTitle"),
    projectUrl: requiredString(input.projectUrl, "projectUrl"),
    iterationId: requiredString(input.iterationId, "iterationId"),
    iterationTitle: requiredString(input.iterationTitle, "iterationTitle"),
  };
}

function isAuthenticationError(error: unknown): boolean {
  if (error instanceof GitHubApiError) return error.kind === "authentication";
  if (error instanceof JiraApiError) return [401, 403].includes(error.status);
  const message = error instanceof Error ? error.message : String(error);
  return /authentication|gh auth login|read:project|HTTP 401|HTTP 403/i.test(message);
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown provider error";
}

function optionalIsoTimestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !Number.isFinite(new Date(value).getTime())) {
    throw new Error("since must be a valid ISO timestamp");
  }
  return new Date(value).toISOString();
}

export function createApiServer(
  ledger: SprintLedger,
  options: ApiServerOptions = {},
): Server {
  const tokenResolver = options.resolveToken ?? (() => resolveGitHubToken(null));
  const projectDiscovery = options.discoverProjects ?? discoverGitHubProjects;
  const connectionSync = options.syncConnection ?? syncGitHubConnection;
  const jiraConnectionSync = options.syncJiraConnection ?? syncJiraConnection;
  const agentConfigStore = options.agentConfigStore ?? new AgentConfigStore();
  const sourceSecretStore = options.sourceSecretStore ?? new SourceSecretStore();
  const atlassianOAuth = options.atlassianOAuth ?? new AtlassianOAuth({
    secrets: sourceSecretStore,
  });
  const askAgent = options.askAgent ?? ((targetLedger, question, since) =>
    runSprintAgent(targetLedger, question, {
      configStore: agentConfigStore,
      since,
    }));
  const syncingConnections = new Set<number>();

  return createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, { status: "ok" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/auth/atlassian/status") {
        sendJson(response, 200, await atlassianOAuth.status());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/atlassian/config") {
        try {
          const body = await readJson(request) as Record<string, unknown>;
          const status = await atlassianOAuth.configure(
            requiredString(body.clientId, "clientId"),
            requiredString(body.clientSecret, "clientSecret"),
          );
          sendJson(response, 200, { status });
        } catch (error) {
          const status = error instanceof AtlassianOAuthError ? error.status : 400;
          sendJson(response, status, {
            error: safeErrorMessage(error),
            kind: "atlassian_oauth",
          });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/auth/atlassian/start") {
        try {
          sendRedirect(response, await atlassianOAuth.authorizationUrl());
        } catch (error) {
          const status = error instanceof AtlassianOAuthError ? error.status : 500;
          sendJson(response, status, { error: safeErrorMessage(error), kind: "atlassian_oauth" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/auth/atlassian/callback") {
        const appUrl = atlassianOAuth.appUrl ?? "http://localhost:5173";
        try {
          const oauthError = url.searchParams.get("error");
          if (oauthError) throw new Error(`Atlassian authorization was denied: ${oauthError}`);
          await atlassianOAuth.complete(
            requiredString(url.searchParams.get("code"), "code"),
            requiredString(url.searchParams.get("state"), "state"),
          );
          sendRedirect(response, `${appUrl}/?atlassian=connected`);
        } catch (error) {
          sendRedirect(
            response,
            `${appUrl}/?atlassian=error&message=${encodeURIComponent(safeErrorMessage(error))}`,
          );
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/atlassian/sites") {
        try {
          sendJson(response, 200, { sites: await atlassianOAuth.listSites() });
        } catch (error) {
          const authentication = isAuthenticationError(error) ||
            (error instanceof AtlassianOAuthError && [401, 403].includes(error.status));
          sendJson(response, authentication ? 401 : 502, {
            error: safeErrorMessage(error),
            kind: authentication ? "authentication" : "provider",
          });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/atlassian/boards") {
        try {
          const cloudId = requiredString(url.searchParams.get("cloudId"), "cloudId");
          sendJson(response, 200, { boards: await atlassianOAuth.listBoards(cloudId) });
        } catch (error) {
          sendJson(response, error instanceof AtlassianOAuthError ? error.status : 400, {
            error: safeErrorMessage(error),
            kind: error instanceof AtlassianOAuthError ? "provider" : "validation",
          });
        }
        return;
      }

      const sprintDiscoveryMatch = url.pathname.match(/^\/api\/atlassian\/boards\/(\d+)\/sprints$/);
      if (request.method === "GET" && sprintDiscoveryMatch) {
        try {
          const cloudId = requiredString(url.searchParams.get("cloudId"), "cloudId");
          const boardId = Number(sprintDiscoveryMatch[1]);
          sendJson(response, 200, await atlassianOAuth.listSprints(cloudId, boardId));
        } catch (error) {
          sendJson(response, error instanceof AtlassianOAuthError ? error.status : 400, {
            error: safeErrorMessage(error),
            kind: error instanceof AtlassianOAuthError ? "provider" : "validation",
          });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/dashboard") {
        if (ledger.getRecentSnapshots(1).length === 0) {
          sendJson(response, 409, {
            error: "At least one sprint snapshot is required",
          });
          return;
        }
        const storedWindow = ledger.getComparisonWindow(
          optionalIsoTimestamp(url.searchParams.get("since")),
        );
        const current = storedWindow.current;
        const baseline = storedWindow.baseline;
        const evaluation = runEvaluationSuite();
        sendJson(response, 200, {
          baseline: serializeSnapshot(baseline),
          current: serializeSnapshot(current),
          events: ledger.getEventsSince(current.id, storedWindow.effectiveSince),
          window: {
            requestedSince: storedWindow.requestedSince,
            effectiveSince: storedWindow.effectiveSince,
            baselineCapturedAt: baseline.capturedAt,
            currentCapturedAt: current.capturedAt,
            coverageComplete: storedWindow.coverageComplete,
            strategy: storedWindow.strategy,
          },
          syncMetrics: ledger.getLatestSyncRunForSnapshot(current.id),
          qualityMetrics: {
            factualCorrectness: evaluation.metrics.factualCorrectness,
            citationCoverage: evaluation.metrics.citationCoverage,
            unsupportedClaimRate: evaluation.metrics.unsupportedClaimRate,
            scenarios: evaluation.metrics.scenarios,
            assertions: evaluation.metrics.assertions,
            durationMs: evaluation.durationMs,
            passed: evaluation.passed,
          },
          source: "ledger",
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/connections") {
        sendJson(response, 200, {
          connections: ledger.getConnectionConfigs(),
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/agent/config") {
        sendJson(response, 200, {
          config: await getPublicAgentConfig(agentConfigStore),
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/agent/runs") {
        const requestedLimit = Number(url.searchParams.get("limit") ?? 10);
        const limit = Number.isSafeInteger(requestedLimit) ? requestedLimit : 10;
        sendJson(response, 200, {
          runs: ledger.getRecentAgentRuns(limit),
        });
        return;
      }

      if (request.method === "PUT" && url.pathname === "/api/agent/config") {
        try {
          const effective = await getPublicAgentConfig(agentConfigStore);
          if (!effective.editable) {
            sendJson(response, 409, {
              error: "Agent configuration is managed by environment variables",
              kind: "environment_override",
            });
            return;
          }
          const saved = await agentConfigStore.save(await readJson(request));
          sendJson(response, 200, {
            config: publicAgentConfig(saved, "local"),
          });
        } catch (error) {
          sendJson(response, 400, {
            error: safeErrorMessage(error),
            kind: "validation",
          });
        }
        return;
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/agent/config/test"
      ) {
        try {
          const runtime = await resolveAgentRuntime(agentConfigStore);
          if (!runtime) {
            sendJson(response, 200, {
              status: "ok",
              provider: "deterministic",
              model: null,
              durationMs: 0,
            });
            return;
          }
          const started = performance.now();
          const result = await runtime.nextTurn({
            instructions:
              "This is a connection test. Call confirm_connection exactly once.",
            conversation: [
              { role: "user", content: "Confirm that tool calling works." },
            ],
            tools: [
              {
                name: "confirm_connection",
                description: "Confirm the agent runtime can request a typed tool.",
                parameters: {
                  type: "object",
                  properties: {},
                  required: [],
                  additionalProperties: false,
                },
              },
            ],
          });
          if (result.toolCall.name !== "confirm_connection") {
            throw new Error("The agent did not call the connection-test tool");
          }
          sendJson(response, 200, {
            status: "ok",
            provider: runtime.provider,
            model: runtime.model,
            durationMs: Number((performance.now() - started).toFixed(2)),
          });
        } catch (error) {
          sendJson(response, 502, {
            error: safeErrorMessage(error),
            kind: "agent_connection",
          });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/github/projects") {
        try {
          const projects = await projectDiscovery(tokenResolver());
          sendJson(response, 200, { projects });
        } catch (error) {
          const authentication = isAuthenticationError(error);
          sendJson(response, authentication ? 401 : 502, {
            error: safeErrorMessage(error),
            kind: authentication ? "authentication" : "provider",
          });
        }
        return;
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/connections/github"
      ) {
        try {
          const config = parseGitHubConnectionConfig(await readJson(request));
          const connection = ledger.saveConnectionConfig(
            "github",
            `${config.owner}/projects/${config.projectNumber}`,
            `${config.owner} · ${config.projectTitle}`,
            config,
          );
          sendJson(response, 201, { connection });
        } catch (error) {
          sendJson(response, 400, {
            error: safeErrorMessage(error),
            kind: "validation",
          });
        }
        return;
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/connections/jira"
      ) {
        try {
          const { config, apiToken } = parseJiraConnectionConfig(
            await readJson(request),
          );
          const externalId = `${config.baseUrl}/sprints/${config.sprintId}`;
          if (apiToken) {
            await sourceSecretStore.set(jiraSecretKey(externalId), apiToken);
          } else if (!await sourceSecretStore.get(jiraSecretKey(externalId))) {
            throw new Error("apiToken is required for a new Jira connection");
          }
          const connection = ledger.saveConnectionConfig(
            "jira",
            externalId,
            `Jira · ${config.sprintName}`,
            config,
          );
          sendJson(response, 201, { connection });
        } catch (error) {
          sendJson(response, 400, {
            error: safeErrorMessage(error),
            kind: "validation",
          });
        }
        return;
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/connections/jira/oauth"
      ) {
        try {
          const status = await atlassianOAuth.status();
          if (!status.connected) throw new Error("Connect Atlassian before saving a sprint");
          const config = parseJiraOAuthConnectionConfig(await readJson(request));
          const externalId = `${config.baseUrl}/sprints/${config.sprintId}`;
          const connection = ledger.saveConnectionConfig(
            "jira",
            externalId,
            `Jira · ${config.sprintName}`,
            config,
          );
          sendJson(response, 201, { connection });
        } catch (error) {
          sendJson(response, 400, { error: safeErrorMessage(error), kind: "validation" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/agent/ask") {
        try {
          const body = await readJson(request);
          const question =
            body && typeof body === "object" && "question" in body
              ? String(body.question).trim()
              : "";
          if (!question) throw new Error("question is required");
          if (question.length > 500) {
            throw new Error("question must be 500 characters or fewer");
          }
          const since = body && typeof body === "object" && "since" in body
            ? optionalIsoTimestamp(body.since)
            : null;
          sendJson(response, 200, {
            answer: await askAgent(ledger, question, since),
          });
        } catch (error) {
          const validation = /question/.test(safeErrorMessage(error));
          sendJson(response, validation ? 400 : 500, {
            error: safeErrorMessage(error),
            kind: validation ? "validation" : "agent",
          });
        }
        return;
      }

      const syncMatch = url.pathname.match(/^\/api\/connections\/(\d+)\/sync$/);
      if (request.method === "POST" && syncMatch) {
        const connectionId = Number(syncMatch[1]);
        const connection = ledger.getConnectionConfig(connectionId);
        if (!connection) {
          sendJson(response, 404, { error: "Connection not found" });
          return;
        }
        if (syncingConnections.has(connectionId)) {
          sendJson(response, 409, {
            error: "A synchronization is already running for this connection",
            kind: "already_running",
          });
          return;
        }

        syncingConnections.add(connectionId);
        try {
          const result = connection.provider === "github"
            ? await connectionSync(
                ledger,
                connection.config as GitHubConnectionConfig,
                tokenResolver(),
              )
            : connection.provider === "jira"
              ? await (async () => {
                  const config = connection.config as JiraConnectionConfig;
                  if (config.authMode === "oauth") {
                    if (!config.cloudId) throw new Error("Jira cloud ID is not configured");
                    return jiraConnectionSync(ledger, config, {
                      type: "oauth",
                      accessToken: await atlassianOAuth.getAccessToken(),
                      cloudId: config.cloudId,
                    });
                  }
                  const apiToken = await sourceSecretStore.get(jiraSecretKey(connection.externalId));
                  if (!apiToken) throw new Error("Jira API token is not configured");
                  return jiraConnectionSync(ledger, config, {
                    type: "api_token",
                    apiToken,
                  });
                })()
              : null;
          if (!result) {
            sendJson(response, 400, { error: "Unsupported connection provider" });
            return;
          }
          sendJson(response, 200, {
            status: result.snapshotCreated ? "updated" : "unchanged",
            ...result,
          });
        } catch (error) {
          const authentication = isAuthenticationError(error);
          sendJson(response, authentication ? 401 : 502, {
            error: safeErrorMessage(error),
            kind: authentication ? "authentication" : "provider",
          });
        } finally {
          syncingConnections.delete(connectionId);
        }
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    })().catch((error: unknown) => {
      if (!response.headersSent) {
        sendJson(response, 500, { error: safeErrorMessage(error) });
      } else {
        response.end();
      }
    });
  });
}
