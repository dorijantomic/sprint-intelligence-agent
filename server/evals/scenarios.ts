import {
  currentSnapshot,
  demoActivityEvents,
  mondaySnapshot,
} from "../../src/data/demoSprint.js";
import type { SprintSnapshot, WorkItem } from "../../src/domain/types.js";
import type { EvalScenario } from "./types.js";

function item(overrides: Partial<WorkItem> & Pick<WorkItem, "id" | "title">): WorkItem {
  const { id, title, ...rest } = overrides;
  return {
    id,
    title,
    type: "issue",
    status: "todo",
    priority: "medium",
    assignee: "maya",
    estimate: 3,
    updatedAt: "2026-09-21T09:00:00Z",
    commentCount: 0,
    blockedBy: [],
    reviewState: "none",
    url: `https://example.test/issues/${id.replace("#", "")}`,
    ...rest,
  };
}

function snapshot(
  id: string,
  capturedAt: string,
  items: WorkItem[],
): SprintSnapshot {
  return {
    id,
    sprintName: "Evaluation sprint",
    sourceName: "Evaluation fixture",
    capturedAt,
    items,
  };
}

const cleanBaseline = snapshot("clean-baseline", "2026-09-21T09:00:00Z", [
  item({ id: "#1", title: "Ship completed change", status: "in_progress" }),
]);
const cleanCurrent = snapshot("clean-current", "2026-09-22T09:00:00Z", [
  item({
    id: "#1",
    title: "Ship completed change",
    status: "done",
    updatedAt: "2026-09-22T08:00:00Z",
  }),
]);

const removalBaseline = snapshot("removal-baseline", "2026-09-21T09:00:00Z", [
  item({ id: "#9", title: "Deferred experiment", priority: "low" }),
]);
const removalCurrent = snapshot("removal-current", "2026-09-22T09:00:00Z", []);

export const evalScenarios: EvalScenario[] = [
  {
    id: "risk-rich-sprint",
    description:
      "Detects scope, status, comment, blocker, review, stale, and ownership signals.",
    baseline: mondaySnapshot,
    current: currentSnapshot,
    events: demoActivityEvents,
    expected: {
      changeCounts: { added: 1, status: 3, comments: 4 },
      risks: [
        { itemId: "#142", kind: "blocked", severity: "high" },
        { itemId: "#139", kind: "review", severity: "high" },
        { itemId: "#128", kind: "stale", severity: "medium" },
        { itemId: "#147", kind: "scope_change", severity: "high" },
        { itemId: "#147", kind: "unowned", severity: "medium" },
      ],
      riskCount: 5,
      completedCount: 2,
      addedCount: 1,
      activeCount: 4,
      answers: [
        {
          question: "What is blocked?",
          includes: ["#142", "#139"],
          excludes: ["#999", "deployment failed"],
          minimumEvidence: 2,
        },
        {
          question: "Give me a holiday catch up",
          includes: ["Catch-up brief", "1 new comment", "1 review"],
          excludes: ["production outage"],
          minimumEvidence: 2,
        },
        {
          question: "What new comments need attention?",
          includes: ["Maya", "#142"],
          excludes: ["Leo commented"],
          minimumEvidence: 1,
        },
      ],
    },
  },
  {
    id: "clean-completion",
    description: "Does not invent risks or citations for a clean completed item.",
    baseline: cleanBaseline,
    current: cleanCurrent,
    events: [],
    expected: {
      changeCounts: { status: 1 },
      risks: [],
      riskCount: 0,
      completedCount: 1,
      addedCount: 0,
      activeCount: 0,
      answers: [
        {
          question: "What is blocked?",
          includes: ["No open blocking relationships"],
          excludes: ["#1 is blocked"],
          minimumEvidence: 0,
        },
      ],
    },
  },
  {
    id: "scope-removal",
    description: "Recognizes work leaving scope without creating a risk.",
    baseline: removalBaseline,
    current: removalCurrent,
    events: [],
    expected: {
      changeCounts: { removed: 1 },
      risks: [],
      riskCount: 0,
      completedCount: 0,
      addedCount: 0,
      activeCount: 0,
      answers: [],
    },
  },
];
