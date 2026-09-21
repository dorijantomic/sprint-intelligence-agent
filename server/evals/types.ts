import type {
  ActivityEvent,
  ChangeKind,
  RiskKind,
  SprintSnapshot,
} from "../../src/domain/types.js";

export interface ExpectedRisk {
  itemId: string;
  kind: RiskKind;
  severity?: "low" | "medium" | "high";
}

export interface ExpectedAnswer {
  question: string;
  includes: string[];
  excludes?: string[];
  minimumEvidence: number;
}

export interface EvalScenario {
  id: string;
  description: string;
  baseline: SprintSnapshot;
  current: SprintSnapshot;
  events: ActivityEvent[];
  expected: {
    changeCounts: Partial<Record<ChangeKind, number>>;
    risks: ExpectedRisk[];
    riskCount: number;
    completedCount: number;
    addedCount: number;
    activeCount: number;
    answers: ExpectedAnswer[];
  };
}

export type EvalAssertionCategory =
  | "fact"
  | "citation"
  | "unsupported_claim";

export interface EvalAssertion {
  category: EvalAssertionCategory;
  name: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
}

export interface EvalScenarioResult {
  id: string;
  description: string;
  passed: boolean;
  assertions: EvalAssertion[];
}

export interface EvalReport {
  version: 1;
  generatedAt: string;
  durationMs: number;
  passed: boolean;
  thresholds: {
    factualCorrectness: number;
    citationCoverage: number;
    maximumUnsupportedClaimRate: number;
  };
  metrics: {
    scenarios: number;
    assertions: number;
    passedAssertions: number;
    factualCorrectness: number;
    citationCoverage: number;
    unsupportedClaimRate: number;
    modelCalls: number;
    estimatedCostUsd: number;
  };
  scenarios: EvalScenarioResult[];
}
