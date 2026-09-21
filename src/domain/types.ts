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
  capturedAt: string;
  items: WorkItem[];
}

export type ChangeKind =
  | "added"
  | "removed"
  | "status"
  | "assignee"
  | "comments";

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
