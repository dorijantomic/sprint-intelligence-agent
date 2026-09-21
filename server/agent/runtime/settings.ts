import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type AgentProvider =
  | "deterministic"
  | "openai"
  | "openai-compatible"
  | "custom";

export interface StoredAgentConfig {
  provider: AgentProvider;
  model: string | null;
  apiKey: string | null;
  baseUrl: string | null;
  runtimeModule: string | null;
}

export interface PublicAgentConfig
  extends Omit<StoredAgentConfig, "apiKey"> {
  hasApiKey: boolean;
  source: "local" | "environment" | "default";
  editable: boolean;
}

const defaultConfig: StoredAgentConfig = {
  provider: "deterministic",
  model: null,
  apiKey: null,
  baseUrl: null,
  runtimeModule: null,
};

const providers = new Set<AgentProvider>([
  "deterministic",
  "openai",
  "openai-compatible",
  "custom",
]);

function optionalString(value: unknown, maximum = 500): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("Invalid agent configuration");
  const trimmed = value.trim();
  if (trimmed.length > maximum) throw new Error("Agent setting is too long");
  return trimmed || null;
}

export function parseAgentConfig(
  input: unknown,
  existing: StoredAgentConfig | null = null,
): StoredAgentConfig {
  if (!input || typeof input !== "object") {
    throw new Error("Agent configuration is required");
  }
  const value = input as Record<string, unknown>;
  if (typeof value.provider !== "string" || !providers.has(value.provider as AgentProvider)) {
    throw new Error("Unsupported agent provider");
  }
  const provider = value.provider as AgentProvider;
  const model = optionalString(value.model, 200);
  const baseUrl = optionalString(value.baseUrl, 1_000);
  const runtimeModule = optionalString(value.runtimeModule, 1_000);
  const clearApiKey = value.clearApiKey === true;
  const suppliedApiKey = optionalString(value.apiKey, 2_000);
  const sameCredentialTarget = Boolean(
    existing &&
    existing.provider === provider &&
    (provider !== "openai-compatible" || existing.baseUrl === baseUrl) &&
    (provider !== "custom" || existing.runtimeModule === runtimeModule),
  );
  const apiKey = clearApiKey
    ? null
    : suppliedApiKey ?? (sameCredentialTarget ? existing?.apiKey ?? null : null);
  const config: StoredAgentConfig = {
    provider,
    model,
    apiKey,
    baseUrl,
    runtimeModule,
  };

  if (provider === "openai") {
    config.model ??= "gpt-5.6";
    if (!config.apiKey) throw new Error("An API key is required for OpenAI");
  }
  if (provider === "openai-compatible") {
    if (!config.model) throw new Error("A model is required");
    if (!config.baseUrl) throw new Error("A base URL is required");
    const protocol = new URL(config.baseUrl).protocol;
    if (protocol !== "http:" && protocol !== "https:") {
      throw new Error("Base URL must use HTTP or HTTPS");
    }
  }
  if (provider === "custom" && !config.runtimeModule) {
    throw new Error("A runtime module path is required");
  }
  return config;
}

export class AgentConfigStore {
  readonly path: string;

  constructor(path = process.env.AGENT_CONFIG_PATH ?? ".data/agent-config.json") {
    this.path = resolve(path);
  }

  async read(): Promise<StoredAgentConfig | null> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      return parseAgentConfig(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(input: unknown): Promise<StoredAgentConfig> {
    const existing = await this.read();
    const config = parseAgentConfig(input, existing);
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.path);
    return config;
  }
}

export function publicAgentConfig(
  config: StoredAgentConfig | null,
  source: PublicAgentConfig["source"],
): PublicAgentConfig {
  const value = config ?? defaultConfig;
  return {
    provider: value.provider,
    model: value.model,
    baseUrl: value.baseUrl,
    runtimeModule: value.runtimeModule,
    hasApiKey: Boolean(value.apiKey),
    source,
    editable: source !== "environment",
  };
}
