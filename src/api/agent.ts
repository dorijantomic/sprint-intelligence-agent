import type { ComparisonWindow, EvidenceLink } from "../domain/types";
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
  fallbackDetail: string | null;
  window: ComparisonWindow;
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

export async function askSprintAgent(
  question: string,
  since: string | null = null,
): Promise<AgentAnswer> {
  const response = await fetch("/api/agent/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, since }),
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

export interface AgentRunSummary {
  id: string;
  snapshotId: string | null;
  question: string;
  answer: AgentAnswer;
  mode: "agent" | "deterministic";
  model: string | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
}

export async function loadAgentRuns(limit = 8): Promise<AgentRunSummary[]> {
  const response = await fetch(`/api/agent/runs?limit=${limit}`);
  const body = (await response.json()) as {
    runs?: AgentRunSummary[];
    error?: string;
  };
  if (!response.ok || !body.runs) {
    throw new ApiError(
      body.error ?? `Agent history failed with HTTP ${response.status}`,
      response.status,
    );
  }
  return body.runs;
}
