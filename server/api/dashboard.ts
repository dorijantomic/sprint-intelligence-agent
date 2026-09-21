import type { StoredSnapshot } from "../ledger/ledger.js";

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

export function serializeSnapshot(snapshot: StoredSnapshot) {
  return {
    id: snapshot.id,
    sprintName: snapshot.iterationName,
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
      reviewState: String(item.review_state ?? "none"),
      url: String(item.url),
    })),
  };
}
