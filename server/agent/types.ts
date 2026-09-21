import type { EvidenceLink } from "../../src/domain/types.js";

export interface AgentClaim {
  text: string;
  kind: "fact" | "interpretation";
  confidence: "high" | "medium" | "low";
  factIds: string[];
  evidenceIds: string[];
}

export interface AgentToolTrace {
  name: string;
  arguments: Record<string, unknown>;
  evidenceIds: string[];
  resultCount: number;
}

export interface AgentAnswer {
  answer: string;
  claims: AgentClaim[];
  evidence: EvidenceLink[];
  mode: "agent" | "deterministic";
  provider: string | null;
  model: string | null;
  fallbackReason: "agent_not_configured" | "agent_error" | null;
  toolsUsed: AgentToolTrace[];
  telemetry: {
    durationMs: number;
    modelCalls: number;
    inputTokens: number;
    outputTokens: number;
  };
}

export interface SubmittedAnswer {
  claims: AgentClaim[];
}
