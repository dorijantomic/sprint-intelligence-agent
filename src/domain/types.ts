export type WorkStatus = "todo" | "in_progress" | "in_review" | "done";
export type Priority = "low" | "medium" | "high" | "urgent";
export type ReviewState = "none" | "pending" | "approved" | "changes_requested";

export interface WorkItem {
  id: string;
  title: string;
  type: "issue" | "pull_request";
  status: WorkStatus;
  priority: Priority;
  assignee: string | null;
  estimate: number;
  updatedAt: string;
  commentCount: number;
  blockedBy: string[];
  reviewState: ReviewState;
  url: string;
}

export interface SprintSnapshot {
  id: string;
  sprintName: string;
  sourceName: string;
  capturedAt: string;
  items: WorkItem[];
}

export interface ComparisonWindow {
  requestedSince: string | null;
  effectiveSince: string;
  baselineCapturedAt: string;
  currentCapturedAt: string;
  coverageComplete: boolean;
  strategy: "latest" | "requested";
}

export interface ActivityEvent {
  id: string;
  itemId: string;
  itemTitle: string;
  kind: string;
  occurredAt: string;
  actor: string | null;
  url: string | null;
  payload: Record<string, unknown>;
}

export interface EvidenceLink {
  id: string;
  label: string;
  url: string;
}

export interface SyncMetrics {
  id: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: "succeeded" | "failed";
  requestCount: number;
  batches: number;
  items: number;
  eventsAdded: number;
  relationships: number;
  errorMessage: string | null;
}

export interface QualityMetrics {
  factualCorrectness: number;
  citationCoverage: number;
  unsupportedClaimRate: number;
  scenarios: number;
  assertions: number;
  durationMs: number;
  passed: boolean;
}

export type ChangeKind =
  | "added"
  | "removed"
  | "status"
  | "assignee"
  | "comments"
  | "review";

export interface SprintChange {
  id: string;
  itemId: string;
  kind: ChangeKind;
  summary: string;
  occurredAt: string;
  evidenceUrl: string;
}

export type RiskKind =
  | "blocked"
  | "stale"
  | "scope_change"
  | "review"
  | "unowned";

export interface SprintRisk {
  id: string;
  itemId: string;
  kind: RiskKind;
  severity: "low" | "medium" | "high";
  title: string;
  reason: string;
  evidenceIds: string[];
}

export interface SprintAnalysis {
  changes: SprintChange[];
  risks: SprintRisk[];
  completedCount: number;
  addedCount: number;
  activeCount: number;
  totalPoints: number;
  completedPoints: number;
}
