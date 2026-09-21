import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentConfigStore } from "../agent/runtime/settings.js";
import { SourceSecretStore } from "../config/source-secrets.js";
import { seedDemoLedger } from "../fixtures/seed-demo.js";
import { SprintLedger } from "../ledger/ledger.js";
import { createApiServer } from "./server.js";

const githubConfig = {
  owner: "maya",
  projectNumber: 1,
  projectTitle: "Delivery",
  projectUrl: "https://github.com/users/maya/projects/1",
  iterationId: "iteration-2",
  iterationTitle: "Sprint 2",
};

describe("dashboard API", () => {
  const servers: Server[] = [];
  const ledgers: SprintLedger[] = [];
  const temporaryDirectories: string[] = [];

  beforeEach(() => {
    for (const name of [
      "AGENT_PROVIDER",
      "AGENT_MODEL",
      "AGENT_API_KEY",
      "AGENT_BASE_URL",
      "AGENT_RUNTIME_MODULE",
      "OPENAI_API_KEY",
      "OPENAI_MODEL",
    ]) {
      vi.stubEnv(name, "");
    }
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(
      servers.splice(0).map(
        (server) => new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
    ledgers.splice(0).forEach((ledger) => ledger.close());
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it("serves persisted baseline and current sprint snapshots", async () => {
    const ledger = new SprintLedger();
    ledgers.push(ledger);
    seedDemoLedger(ledger);
    const server = createApiServer(ledger);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/dashboard`,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source).toBe("ledger");
    expect(body.current.sourceName).toBe("ACME Checkout demo");
    expect(body.baseline.items).toHaveLength(5);
    expect(body.current.items).toHaveLength(6);
    expect(body.current.items).toContainEqual(
      expect.objectContaining({ id: "#142", blockedBy: ["#139"] }),
    );
    expect(body.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "fixture-comment-142",
          itemId: "#142",
          kind: "commented",
          actor: "Maya",
        }),
        expect.objectContaining({
          id: "fixture-review-139",
          itemId: "#139",
          kind: "reviewed",
          actor: "Iris",
        }),
      ]),
    );
    expect(body.syncMetrics).toEqual(
      expect.objectContaining({
        status: "succeeded",
        durationMs: 50,
        requestCount: 1,
        items: 6,
        eventsAdded: 2,
      }),
    );
    expect(body.qualityMetrics).toEqual(
      expect.objectContaining({
        factualCorrectness: 1,
        citationCoverage: 1,
        unsupportedClaimRate: 0,
        passed: true,
      }),
    );
  });

  it("saves and lists a GitHub connection without a token", async () => {
    const ledger = new SprintLedger();
    ledgers.push(ledger);
    const server = createApiServer(ledger);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const savedResponse = await fetch(`${baseUrl}/api/connections/github`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(githubConfig),
    });
    const saved = await savedResponse.json();
    const listResponse = await fetch(`${baseUrl}/api/connections`);
    const list = await listResponse.json();

    expect(savedResponse.status).toBe(201);
    expect(saved.connection).toEqual(
      expect.objectContaining({
        provider: "github",
        displayName: "maya · Delivery",
        config: githubConfig,
      }),
    );
    expect(list.connections).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain("token");
  });

  it("stores a Jira token outside the ledger and uses it for synchronization", async () => {
    const directory = await mkdtemp(join(tmpdir(), "orbit-api-jira-secret-"));
    temporaryDirectories.push(directory);
    const secretStore = new SourceSecretStore(join(directory, "sources.json"));
    const ledger = new SprintLedger();
    ledgers.push(ledger);
    const syncJira = vi.fn(async (_ledger, _config, _credential) => ({
      summary: {
        batches: 1,
        items: 2,
        eventsAdded: 1,
        relationships: 1,
        cursor: null,
        durationMs: 10,
        requestCount: 4,
      },
      snapshotId: "jira-snapshot",
      snapshotCreated: true,
      snapshotItems: 2,
    }));
    const server = createApiServer(ledger, {
      sourceSecretStore: secretStore,
      syncJiraConnection: syncJira,
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const saveResponse = await fetch(`${baseUrl}/api/connections/jira`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl: "https://team.atlassian.net",
        email: "engineer@example.com",
        apiToken: "jira-secret-token",
        sprintId: 42,
        sprintName: "Platform Sprint 9",
        storyPointField: "customfield_10016",
      }),
    });
    const saved = await saveResponse.json();
    const syncResponse = await fetch(
      `${baseUrl}/api/connections/${saved.connection.id}/sync`,
      { method: "POST" },
    );
    const listed = await (await fetch(`${baseUrl}/api/connections`)).json();

    expect(saveResponse.status).toBe(201);
    expect(syncResponse.status).toBe(200);
    expect(syncJira).toHaveBeenCalledWith(
      ledger,
      expect.objectContaining({ sprintId: 42 }),
      { type: "api_token", apiToken: "jira-secret-token" },
    );
    expect(JSON.stringify({ saved, listed })).not.toContain("jira-secret-token");
  });

  it("discovers and synchronizes an OAuth-connected Jira sprint without exposing tokens", async () => {
    const ledger = new SprintLedger();
    ledgers.push(ledger);
    const atlassianOAuth = {
      status: vi.fn(async () => ({ configured: true, connected: true, missing: [] })),
      configure: vi.fn(async () => ({ configured: true, connected: false, missing: [] })),
      authorizationUrl: vi.fn(async () => "https://auth.atlassian.com/authorize"),
      complete: vi.fn(async () => undefined),
      getAccessToken: vi.fn(async () => "oauth-access-token"),
      listSites: vi.fn(async () => [{ id: "cloud-1", name: "Acme", url: "https://acme.atlassian.net" }]),
      listBoards: vi.fn(async () => [{ id: 34, name: "Delivery", type: "scrum", projectKey: "DEL" }]),
      listSprints: vi.fn(async () => ({
        sprints: [{ id: 7, name: "Sprint 7", state: "active", startDate: null, endDate: null }],
        storyPointField: "customfield_10016",
      })),
    };
    const syncJira = vi.fn(async () => ({
      summary: { batches: 1, items: 1, eventsAdded: 0, relationships: 0, cursor: null, durationMs: 5, requestCount: 3 },
      snapshotId: "oauth-snapshot",
      snapshotCreated: true,
      snapshotItems: 1,
    }));
    const server = createApiServer(ledger, {
      atlassianOAuth,
      syncJiraConnection: syncJira,
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const configResponse = await fetch(`${baseUrl}/api/auth/atlassian/config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: "ui-client", clientSecret: "ui-secret" }),
    });
    const configured = await configResponse.json();
    const sites = await (await fetch(`${baseUrl}/api/atlassian/sites`)).json();
    const boards = await (await fetch(`${baseUrl}/api/atlassian/boards?cloudId=cloud-1`)).json();
    const discovery = await (await fetch(`${baseUrl}/api/atlassian/boards/34/sprints?cloudId=cloud-1`)).json();
    const saveResponse = await fetch(`${baseUrl}/api/connections/jira/oauth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        authMode: "oauth",
        cloudId: "cloud-1",
        baseUrl: "https://acme.atlassian.net",
        sprintId: 7,
        sprintName: "Sprint 7",
        storyPointField: discovery.storyPointField,
      }),
    });
    const saved = await saveResponse.json();
    const syncResponse = await fetch(`${baseUrl}/api/connections/${saved.connection.id}/sync`, { method: "POST" });

    expect(configResponse.status).toBe(200);
    expect(atlassianOAuth.configure).toHaveBeenCalledWith("ui-client", "ui-secret");
    expect(JSON.stringify(configured)).not.toContain("ui-secret");
    expect(sites.sites[0].id).toBe("cloud-1");
    expect(boards.boards[0].id).toBe(34);
    expect(saveResponse.status).toBe(201);
    expect(syncResponse.status).toBe(200);
    expect(syncJira).toHaveBeenCalledWith(
      ledger,
      expect.objectContaining({ authMode: "oauth", cloudId: "cloud-1", sprintId: 7 }),
      { type: "oauth", cloudId: "cloud-1", accessToken: "oauth-access-token" },
    );
    expect(JSON.stringify({ sites, boards, discovery, saved })).not.toContain("oauth-access-token");
  });

  it("rejects concurrent syncs for the same connection", async () => {
    const ledger = new SprintLedger();
    ledgers.push(ledger);
    const connection = ledger.saveConnectionConfig(
      "github",
      "maya/projects/1",
      "maya · Delivery",
      githubConfig,
    );
    let releaseSync!: () => void;
    let markStarted!: () => void;
    const syncStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const syncGate = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    const server = createApiServer(ledger, {
      resolveToken: () => "secret",
      syncConnection: async () => {
        markStarted();
        await syncGate;
        return {
          summary: {
            batches: 1,
            items: 3,
            eventsAdded: 1,
            relationships: 0,
            cursor: null,
            durationMs: 12,
            requestCount: 1,
          },
          snapshotId: "snapshot-1",
          snapshotCreated: true,
          snapshotItems: 3,
        };
      },
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}/api/connections/${connection.id}/sync`;

    const firstRequest = fetch(url, { method: "POST" });
    await syncStarted;
    const duplicateResponse = await fetch(url, { method: "POST" });
    const duplicate = await duplicateResponse.json();
    releaseSync();
    const firstResponse = await firstRequest;

    expect(duplicateResponse.status).toBe(409);
    expect(duplicate.kind).toBe("already_running");
    expect(firstResponse.status).toBe(200);
  });

  it("surfaces GitHub authentication failures distinctly", async () => {
    const ledger = new SprintLedger();
    ledgers.push(ledger);
    const server = createApiServer(ledger, {
      resolveToken: () => {
        throw new Error("GitHub authentication is unavailable. Run `gh auth login`.");
      },
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/github/projects`,
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.kind).toBe("authentication");
  });

  it("saves agent settings locally without returning the API key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "orbit-api-agent-config-"));
    temporaryDirectories.push(directory);
    const configStore = new AgentConfigStore(join(directory, "config.json"));
    const ledger = new SprintLedger();
    ledgers.push(ledger);
    const server = createApiServer(ledger, { agentConfigStore: configStore });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const saveResponse = await fetch(`${baseUrl}/api/agent/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "openai",
        model: "test-model",
        apiKey: "never-return-this",
      }),
    });
    const saved = await saveResponse.json();
    const getResponse = await fetch(`${baseUrl}/api/agent/config`);
    const loaded = await getResponse.json();

    expect(saveResponse.status).toBe(200);
    expect(saved.config).toEqual(
      expect.objectContaining({
        provider: "openai",
        model: "test-model",
        hasApiKey: true,
        editable: true,
      }),
    );
    expect(loaded.config).toEqual(saved.config);
    expect(JSON.stringify({ saved, loaded })).not.toContain("never-return-this");
  });

  it("tests deterministic agent configuration without an external service", async () => {
    const directory = await mkdtemp(join(tmpdir(), "orbit-api-agent-test-"));
    temporaryDirectories.push(directory);
    const configStore = new AgentConfigStore(join(directory, "config.json"));
    await configStore.save({ provider: "deterministic" });
    const ledger = new SprintLedger();
    ledgers.push(ledger);
    const server = createApiServer(ledger, { agentConfigStore: configStore });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/agent/config/test`,
      { method: "POST" },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({ status: "ok", provider: "deterministic" }),
    );
  });

  it("serves a structured evidence-backed agent answer", async () => {
    const ledger = new SprintLedger();
    ledgers.push(ledger);
    seedDemoLedger(ledger);
    const server = createApiServer(ledger, {
      askAgent: async (_ledger, question) => ({
        answer: `${question} #142 is blocked by #139.`,
        claims: [
          {
            text: "#142 is blocked by #139.",
            kind: "fact",
            confidence: "high",
            factIds: ["risk:#142-blocked"],
            evidenceIds: ["work-item:#142", "work-item:#139"],
          },
        ],
        evidence: [
          {
            id: "work-item:#142",
            label: "#142 · Retry payment authorization",
            url: "https://example.test/issues/142",
          },
        ],
        mode: "agent",
        provider: "test-provider",
        model: "test-model",
        fallbackReason: null,
        fallbackDetail: null,
        window: {
          requestedSince: null,
          effectiveSince: "2026-02-09T09:00:00.000Z",
          baselineCapturedAt: "2026-02-09T09:00:00.000Z",
          currentCapturedAt: "2026-02-12T16:00:00.000Z",
          coverageComplete: true,
          strategy: "latest",
        },
        toolsUsed: [],
        telemetry: {
          durationMs: 12,
          modelCalls: 2,
          inputTokens: 100,
          outputTokens: 30,
        },
      }),
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/agent/ask`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "What is blocked?" }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.answer).toEqual(
      expect.objectContaining({
        mode: "agent",
        answer: expect.stringContaining("#142"),
      }),
    );
  });
});
