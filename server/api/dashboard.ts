import type { StoredSnapshot } from "../ledger/ledger.js";
import type { SprintSnapshot } from "../../src/domain/types.js";

function status(value: unknown): "todo" | "in_progress" | "in_review" | "done" {
  const normalized = String(value).toLowerCase().replaceAll(/\s+/g, "_");
  if (["done", "closed", "complete", "completed", "merged"].includes(normalized)) {
    return "done";
  }
  if (["in_review", "review", "ready_for_review"].includes(normalized)) {
    return "in_review";
  }
  if (["todo", "to_do", "backlog", "open"].includes(normalized)) return "todo";
  return "in_progress";
}

function priority(value: unknown): "low" | "medium" | "high" | "urgent" {
  const normalized = String(value).toLowerCase();
  if (normalized === "urgent" || normalized === "high" || normalized === "low") {
    return normalized;
  }
  return "medium";
}

function reviewState(
  value: unknown,
): "none" | "pending" | "approved" | "changes_requested" {
  const normalized = String(value).toLowerCase();
  if (
    normalized === "pending" ||
    normalized === "approved" ||
    normalized === "changes_requested"
  ) {
    return normalized;
  }
  return "none";
}

export function serializeSnapshot(snapshot: StoredSnapshot): SprintSnapshot {
  return {
    id: snapshot.id,
    sprintName: snapshot.iterationName,
    sourceName: snapshot.sourceName,
    capturedAt: snapshot.capturedAt,
    items: snapshot.items.map((item) => ({
      id: String(item.item_key),
      title: String(item.title),
      type: item.kind === "pull_request" ? "pull_request" : "issue",
      status: status(item.status),
      priority: priority(item.priority),
      assignee: item.assignee === null ? null : String(item.assignee),
      estimate: Number(item.estimate ?? 0),
      updatedAt: String(item.source_updated_at),
      commentCount: Number(item.comment_count ?? 0),
      blockedBy: Array.isArray(item.blocked_by)
        ? item.blocked_by.map(String)
        : [],
      reviewState: reviewState(item.review_state),
      url: String(item.url),
    })),
  };
}
