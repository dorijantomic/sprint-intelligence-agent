import type { EvidenceLink } from "../domain/types";
import { ApiError } from "./connections";

export interface AgentClaim {
  text: string;
  kind: "fact" | "interpretation";
  confidence: "high" | "medium" | "low";
  factIds: string[];
  evidenceIds: string[];
}

export interface AgentAnswer {
  answer: string;
  claims: AgentClaim[];
  evidence: EvidenceLink[];
  mode: "agent" | "deterministic";
  provider: string | null;
  model: string | null;
  fallbackReason: "agent_not_configured" | "agent_error" | null;
  toolsUsed: Array<{
    name: string;
    arguments: Record<string, unknown>;
    evidenceIds: string[];
    resultCount: number;
  }>;
  telemetry: {
    durationMs: number;
    modelCalls: number;
    inputTokens: number;
    outputTokens: number;
  };
}

export async function askSprintAgent(question: string): Promise<AgentAnswer> {
  const response = await fetch("/api/agent/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
  });
  const body = (await response.json()) as {
    answer?: AgentAnswer;
    error?: string;
    kind?: string;
  };
  if (!response.ok || !body.answer) {
    throw new ApiError(
      body.error ?? `Agent request failed with HTTP ${response.status}`,
      response.status,
      body.kind,
    );
  }
  return body.answer;
}
