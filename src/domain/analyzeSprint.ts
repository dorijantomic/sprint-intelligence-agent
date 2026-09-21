import type {
  SprintAnalysis,
  SprintChange,
  SprintRisk,
  SprintSnapshot,
  WorkItem,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

function change(
  item: WorkItem,
  kind: SprintChange["kind"],
  summary: string,
  occurredAt: string,
): SprintChange {
  return {
    id: `${item.id}-${kind}-${occurredAt}`,
    itemId: item.id,
    kind,
    summary,
    occurredAt,
    evidenceUrl: item.url,
  };
}

function risk(
  item: WorkItem,
  kind: SprintRisk["kind"],
  severity: SprintRisk["severity"],
  title: string,
  reason: string,
  evidenceIds: string[] = [item.id],
): SprintRisk {
  return {
    id: `${item.id}-${kind}`,
    itemId: item.id,
    kind,
    severity,
    title,
    reason,
    evidenceIds,
  };
}

export function analyzeSprint(
  baseline: SprintSnapshot,
  current: SprintSnapshot,
  staleAfterDays = 3,
): SprintAnalysis {
  const beforeById = new Map(baseline.items.map((item) => [item.id, item]));
  const nowById = new Map(current.items.map((item) => [item.id, item]));
  const changes: SprintChange[] = [];
  const risks: SprintRisk[] = [];
  const currentTime = new Date(current.capturedAt).getTime();

  for (const item of current.items) {
    const before = beforeById.get(item.id);

    if (!before) {
      changes.push(
        change(item, "added", `${item.id} entered sprint scope`, current.capturedAt),
      );
      risks.push(
        risk(
          item,
          "scope_change",
          item.priority === "urgent" ? "high" : "medium",
          "Scope added mid-sprint",
          `${item.id} was not present in the baseline snapshot.`,
        ),
      );
    } else {
      if (before.status !== item.status) {
        changes.push(
          change(
            item,
            "status",
            `${item.id} moved from ${before.status} to ${item.status}`,
            item.updatedAt,
          ),
        );
      }

      if (before.assignee !== item.assignee) {
        changes.push(
          change(
            item,
            "assignee",
            `${item.id} reassigned from ${before.assignee ?? "unassigned"} to ${item.assignee ?? "unassigned"}`,
            item.updatedAt,
          ),
        );
      }

      const addedComments = item.commentCount - before.commentCount;
      if (addedComments > 0) {
        changes.push(
          change(
            item,
            "comments",
            `${addedComments} new comment${addedComments === 1 ? "" : "s"} on ${item.id}`,
            item.updatedAt,
          ),
        );
      }
    }

    const openBlockers = item.blockedBy.filter(
      (blockerId) => nowById.get(blockerId)?.status !== "done",
    );
    if (item.status !== "done" && openBlockers.length > 0) {
      risks.push(
        risk(
          item,
          "blocked",
          item.priority === "urgent" || item.priority === "high" ? "high" : "medium",
          "Blocked by unfinished work",
          `${item.id} is waiting on ${openBlockers.join(", ")}.`,
          [item.id, ...openBlockers],
        ),
      );
    }

    const ageInDays = (currentTime - new Date(item.updatedAt).getTime()) / DAY_MS;
    if (
      item.status !== "done" &&
      item.status !== "todo" &&
      ageInDays >= staleAfterDays
    ) {
      risks.push(
        risk(
          item,
          "stale",
          "medium",
          "Active work has gone quiet",
          `${item.id} has had no recorded activity for ${Math.floor(ageInDays)} days.`,
        ),
      );
    }

    if (item.status !== "done" && item.reviewState === "changes_requested") {
      risks.push(
        risk(
          item,
          "review",
          "high",
          "Review changes requested",
          `${item.id} cannot merge until requested changes are resolved.`,
        ),
      );
    }

    if (item.status !== "done" && item.assignee === null) {
      risks.push(
        risk(
          item,
          "unowned",
          "medium",
          "Work has no owner",
          `${item.id} is in sprint scope without an assignee.`,
        ),
      );
    }
  }

  for (const item of baseline.items) {
    if (!nowById.has(item.id)) {
      changes.push(
        change(item, "removed", `${item.id} left sprint scope`, current.capturedAt),
      );
    }
  }

  const completedItems = current.items.filter((item) => item.status === "done");

  return {
    changes: changes.sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    ),
    risks: risks.sort((a, b) => {
      const rank = { high: 3, medium: 2, low: 1 };
      return rank[b.severity] - rank[a.severity];
    }),
    completedCount: completedItems.length,
    addedCount: current.items.filter((item) => !beforeById.has(item.id)).length,
    activeCount: current.items.filter(
      (item) => item.status === "in_progress" || item.status === "in_review",
    ).length,
    totalPoints: current.items.reduce((sum, item) => sum + item.estimate, 0),
    completedPoints: completedItems.reduce((sum, item) => sum + item.estimate, 0),
  };
}

export function answerSprintQuestion(
  question: string,
  analysis: SprintAnalysis,
): string {
  const normalized = question.toLowerCase();
  const highRisks = analysis.risks.filter((item) => item.severity === "high");
  const blockers = analysis.risks.filter((item) => item.kind === "blocked");
  const stale = analysis.risks.filter((item) => item.kind === "stale");

  if (normalized.includes("block")) {
    if (blockers.length === 0) return "No open blocking relationships were found.";
    return `${blockers.length} blocked item${blockers.length === 1 ? "" : "s"}: ${blockers.map((item) => `${item.itemId} — ${item.reason}`).join(" ")}`;
  }

  if (normalized.includes("stale") || normalized.includes("quiet")) {
    if (stale.length === 0) return "No active work is beyond the staleness threshold.";
    return `${stale.length} stale item${stale.length === 1 ? "" : "s"}: ${stale.map((item) => `${item.itemId} — ${item.reason}`).join(" ")}`;
  }

  if (normalized.includes("risk")) {
    return `${analysis.risks.length} risks are open, including ${highRisks.length} high-severity item${highRisks.length === 1 ? "" : "s"}. ${highRisks.map((item) => `${item.itemId}: ${item.title}.`).join(" ")}`;
  }

  return `${analysis.changes.length} material changes since Monday: ${analysis.completedCount} items are done, ${analysis.addedCount} entered scope, and ${analysis.risks.length} risks need attention. Highest priority: ${highRisks.map((item) => `${item.itemId} (${item.title.toLowerCase()})`).join(", ") || "none"}.`;
}
