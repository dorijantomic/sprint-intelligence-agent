import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentConfigStore, publicAgentConfig } from "./settings.js";

describe("AgentConfigStore", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  async function store(): Promise<AgentConfigStore> {
    const directory = await mkdtemp(join(tmpdir(), "orbit-agent-settings-"));
    temporaryDirectories.push(directory);
    return new AgentConfigStore(join(directory, "agent-config.json"));
  }

  it("stores secrets in an owner-only local file and redacts public output", async () => {
    const configStore = await store();
    const saved = await configStore.save({
      provider: "openai",
      model: "test-model",
      apiKey: "top-secret",
    });
    const file = await stat(configStore.path);
    const publicConfig = publicAgentConfig(saved, "local");

    expect(file.mode & 0o777).toBe(0o600);
    expect(publicConfig.hasApiKey).toBe(true);
    expect(JSON.stringify(publicConfig)).not.toContain("top-secret");
  });

  it("retains a saved key when the UI submits an empty replacement", async () => {
    const configStore = await store();
    await configStore.save({
      provider: "openai",
      model: "test-model",
      apiKey: "keep-me",
    });
    await configStore.save({
      provider: "openai",
      model: "new-model",
    });

    expect(await configStore.read()).toEqual(
      expect.objectContaining({ apiKey: "keep-me", model: "new-model" }),
    );
  });

  it("can explicitly clear a stored key", async () => {
    const configStore = await store();
    await configStore.save({
      provider: "openai-compatible",
      model: "local-model",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "remove-me",
    });
    await configStore.save({
      provider: "openai-compatible",
      model: "local-model",
      baseUrl: "http://127.0.0.1:11434/v1",
      clearApiKey: true,
    });

    expect((await configStore.read())?.apiKey).toBeNull();
  });

  it("does not carry a secret to a different provider endpoint", async () => {
    const configStore = await store();
    await configStore.save({
      provider: "openai-compatible",
      model: "first-model",
      baseUrl: "https://first.example/v1",
      apiKey: "endpoint-specific-secret",
    });
    await configStore.save({
      provider: "openai-compatible",
      model: "second-model",
      baseUrl: "https://second.example/v1",
    });

    expect((await configStore.read())?.apiKey).toBeNull();
  });

  it("fills Gemini endpoint and model defaults from only an AI Studio key", async () => {
    const configStore = await store();
    await configStore.save({
      provider: "gemini",
      apiKey: "gemini-test-key",
    });

    expect(await configStore.read()).toEqual({
      provider: "gemini",
      model: "gemini-3.8-flash",
      apiKey: "gemini-test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      runtimeModule: null,
    });
  });

  it("configures the OpenCode Go gateway from a subscription key", async () => {
    const configStore = await store();
    await configStore.save({
      provider: "opencode-go",
      apiKey: "go-test-key",
    });

    expect(await configStore.read()).toEqual({
      provider: "opencode-go",
      model: "gpt-5.6-luna",
      apiKey: "go-test-key",
      baseUrl: "https://opencode.ai/zen/go/v1",
      runtimeModule: null,
    });
  });
});
