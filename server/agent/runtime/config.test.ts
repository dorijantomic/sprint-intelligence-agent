import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAgentRuntime } from "./config.js";

describe("resolveAgentRuntime", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it("uses the deterministic runtime when explicitly selected", async () => {
    vi.stubEnv("AGENT_PROVIDER", "deterministic");
    expect(await resolveAgentRuntime()).toBeNull();
  });

  it("configures an OpenAI-compatible local runtime without a vendor key", async () => {
    vi.stubEnv("AGENT_PROVIDER", "openai-compatible");
    vi.stubEnv("AGENT_BASE_URL", "http://127.0.0.1:11434/v1");
    vi.stubEnv("AGENT_MODEL", "local-tool-model");
    vi.stubEnv("AGENT_API_KEY", "");

    const runtime = await resolveAgentRuntime();

    expect(runtime).toEqual(
      expect.objectContaining({
        provider: "openai-compatible",
        model: "local-tool-model",
      }),
    );
  });

  it("loads a supplied custom agent runtime module", async () => {
    const directory = await mkdtemp(join(tmpdir(), "orbit-agent-runtime-"));
    temporaryDirectories.push(directory);
    const modulePath = join(directory, "custom-runtime.mjs");
    await writeFile(
      modulePath,
      `export function createAgentRuntime(config) {
        return {
          provider: "supplied-agent",
          model: config.model || "agent-default",
          async nextTurn() { throw new Error("not called in configuration test"); }
        };
      }`,
      "utf8",
    );
    vi.stubEnv("AGENT_PROVIDER", "custom");
    vi.stubEnv("AGENT_RUNTIME_MODULE", modulePath);
    vi.stubEnv("AGENT_MODEL", "agent-model");

    const runtime = await resolveAgentRuntime();

    expect(runtime).toEqual(
      expect.objectContaining({
        provider: "supplied-agent",
        model: "agent-model",
      }),
    );
  });
});
