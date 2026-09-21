import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { resolveGitHubToken } from "../config/github-sync.js";
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
import { runEvaluationSuite } from "../evals/evaluate.js";
import { SprintLedger } from "../ledger/ledger.js";
import {
  syncGitHubConnection,
  type GitHubConnectionConfig,
  type GitHubConnectionSyncResult,
} from "../sync/github-connection.js";
import { serializeSnapshot } from "./dashboard.js";

type TokenResolver = () => string;
type ProjectDiscovery = (token: string) => Promise<GitHubProjectOption[]>;
type ConnectionSync = (
  ledger: SprintLedger,
  config: GitHubConnectionConfig,
  token: string,
) => Promise<GitHubConnectionSyncResult>;
type AskAgent = (
  ledger: SprintLedger,
  question: string,
) => Promise<AgentAnswer>;

export interface ApiServerOptions {
  resolveToken?: TokenResolver;
  discoverProjects?: ProjectDiscovery;
  syncConnection?: ConnectionSync;
  askAgent?: AskAgent;
  agentConfigStore?: AgentConfigStore;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
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
  field: keyof GitHubConnectionConfig,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
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
  const message = error instanceof Error ? error.message : String(error);
  return /authentication|gh auth login|read:project|HTTP 401|HTTP 403/i.test(message);
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown provider error";
}

export function createApiServer(
  ledger: SprintLedger,
  options: ApiServerOptions = {},
): Server {
  const tokenResolver = options.resolveToken ?? (() => resolveGitHubToken(null));
  const projectDiscovery = options.discoverProjects ?? discoverGitHubProjects;
  const connectionSync = options.syncConnection ?? syncGitHubConnection;
  const agentConfigStore = options.agentConfigStore ?? new AgentConfigStore();
  const askAgent = options.askAgent ?? ((targetLedger, question) =>
    runSprintAgent(targetLedger, question, { configStore: agentConfigStore }));
  const syncingConnections = new Set<number>();

  return createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, { status: "ok" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/dashboard") {
        const snapshots = ledger.getRecentSnapshots(2);
        if (snapshots.length === 0) {
          sendJson(response, 409, {
            error: "At least one sprint snapshot is required",
          });
          return;
        }
        const current = snapshots[0];
        const baseline = snapshots[1] ?? current;
        const evaluation = runEvaluationSuite();
        sendJson(response, 200, {
          baseline: serializeSnapshot(baseline),
          current: serializeSnapshot(current),
          events:
            baseline.id === current.id
              ? []
              : ledger.getEventsBetweenSnapshots(baseline.id, current.id),
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
          connections: ledger.getConnectionConfigs("github"),
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/agent/config") {
        sendJson(response, 200, {
          config: await getPublicAgentConfig(agentConfigStore),
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
          sendJson(response, 200, { answer: await askAgent(ledger, question) });
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
        const connection = ledger.getConnectionConfig<GitHubConnectionConfig>(
          connectionId,
        );
        if (!connection || connection.provider !== "github") {
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
          const result = await connectionSync(
            ledger,
            connection.config,
            tokenResolver(),
          );
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
