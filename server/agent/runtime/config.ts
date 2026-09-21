import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { OpenAICompatibleRuntime, OpenAIResponsesRuntime } from "./openai.js";
import type {
  AgentRuntime,
  AgentRuntimeFactory,
  AgentRuntimeFactoryConfig,
} from "./types.js";

function env(name: string): string | null {
  return process.env[name]?.trim() || null;
}

async function loadCustomRuntime(
  modulePath: string,
  config: AgentRuntimeFactoryConfig,
): Promise<AgentRuntime> {
  const url = pathToFileURL(resolve(process.cwd(), modulePath)).href;
  const imported = (await import(url)) as {
    default?: AgentRuntimeFactory;
    createAgentRuntime?: AgentRuntimeFactory;
  };
  const factory = imported.createAgentRuntime ?? imported.default;
  if (typeof factory !== "function") {
    throw new Error(
      "AGENT_RUNTIME_MODULE must export createAgentRuntime or a default factory",
    );
  }
  const runtime = await factory(config);
  if (
    !runtime ||
    typeof runtime.provider !== "string" ||
    typeof runtime.model !== "string" ||
    typeof runtime.nextTurn !== "function"
  ) {
    throw new Error("Custom agent module returned an invalid runtime");
  }
  return runtime;
}

export async function resolveAgentRuntime(): Promise<AgentRuntime | null> {
  const legacyApiKey = env("OPENAI_API_KEY");
  const provider = (
    env("AGENT_PROVIDER") ??
    (env("AGENT_RUNTIME_MODULE")
      ? "custom"
      : env("AGENT_BASE_URL")
        ? "openai-compatible"
        : legacyApiKey
          ? "openai"
          : "deterministic")
  ).toLowerCase();
  const apiKey = env("AGENT_API_KEY") ?? legacyApiKey;
  const baseUrl = env("AGENT_BASE_URL");
  const model = env("AGENT_MODEL") ?? env("OPENAI_MODEL");

  if (provider === "deterministic" || provider === "none") return null;

  if (provider === "openai") {
    if (!apiKey) throw new Error("AGENT_API_KEY is required for OpenAI");
    return new OpenAIResponsesRuntime({
      apiKey,
      model: model ?? "gpt-5.6",
      baseUrl: baseUrl ?? undefined,
    });
  }

  if (provider === "openai-compatible") {
    if (!baseUrl) {
      throw new Error("AGENT_BASE_URL is required for an OpenAI-compatible agent");
    }
    if (!model) throw new Error("AGENT_MODEL is required");
    return new OpenAICompatibleRuntime({
      provider,
      apiKey: apiKey ?? "local",
      baseUrl,
      model,
    });
  }

  if (provider === "custom") {
    const modulePath = env("AGENT_RUNTIME_MODULE");
    if (!modulePath) throw new Error("AGENT_RUNTIME_MODULE is required");
    return loadCustomRuntime(modulePath, {
      provider,
      model,
      apiKey,
      baseUrl,
    });
  }

  throw new Error(
    `Unsupported AGENT_PROVIDER "${provider}". Use openai, openai-compatible, custom, or deterministic.`,
  );
}
