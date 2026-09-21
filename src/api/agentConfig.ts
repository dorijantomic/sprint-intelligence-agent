import { ApiError } from "./connections";

export type AgentProvider =
  | "deterministic"
  | "openai"
  | "opencode-go"
  | "gemini"
  | "openai-compatible"
  | "custom";

export interface AgentConfig {
  provider: AgentProvider;
  model: string | null;
  baseUrl: string | null;
  runtimeModule: string | null;
  hasApiKey: boolean;
  source: "local" | "environment" | "default";
  editable: boolean;
}

export interface AgentConfigInput {
  provider: AgentProvider;
  model: string | null;
  apiKey?: string | null;
  clearApiKey?: boolean;
  baseUrl: string | null;
  runtimeModule: string | null;
}

async function responseBody<T>(response: Response, field: string): Promise<T> {
  const body = (await response.json()) as Record<string, unknown>;
  const value = body[field];
  if (!response.ok || value === undefined) {
    throw new ApiError(
      typeof body.error === "string"
        ? body.error
        : `Agent configuration failed with HTTP ${response.status}`,
      response.status,
      typeof body.kind === "string" ? body.kind : undefined,
    );
  }
  return value as T;
}

export async function loadAgentConfig(): Promise<AgentConfig> {
  const response = await fetch("/api/agent/config");
  return responseBody<AgentConfig>(response, "config");
}

export async function saveAgentConfig(
  config: AgentConfigInput,
): Promise<AgentConfig> {
  const response = await fetch("/api/agent/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config),
  });
  return responseBody<AgentConfig>(response, "config");
}

export interface AgentConnectionTest {
  status: "ok";
  provider: string;
  model: string | null;
  durationMs: number;
}

export async function testAgentConfig(): Promise<AgentConnectionTest> {
  const response = await fetch("/api/agent/config/test", { method: "POST" });
  const body = (await response.json()) as AgentConnectionTest & {
    error?: string;
    kind?: string;
  };
  if (!response.ok) {
    throw new ApiError(
      body.error ?? `Agent connection test failed with HTTP ${response.status}`,
      response.status,
      body.kind,
    );
  }
  return body;
}
