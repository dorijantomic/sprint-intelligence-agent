import { describe, expect, it } from "vitest";
import {
  currentSnapshot,
  demoActivityEvents,
  mondaySnapshot,
} from "../data/demoSprint";
import {
  activityEventsToChanges,
  analyzeSprint,
  answerSprintQuestion,
  evidenceForSprintQuestion,
} from "./analyzeSprint";

describe("analyzeSprint", () => {
  it("finds status, comment, and scope changes", () => {
    const result = analyzeSprint(mondaySnapshot, currentSnapshot);

    expect(result.addedCount).toBe(1);
    expect(result.completedCount).toBe(2);
    expect(result.changes.some((item) => item.kind === "added")).toBe(true);
    expect(result.changes.filter((item) => item.kind === "status")).toHaveLength(3);
    expect(result.changes.filter((item) => item.kind === "comments")).toHaveLength(4);
  });

  it("traces open dependencies and does not flag completed blockers", () => {
    const result = analyzeSprint(mondaySnapshot, currentSnapshot);
    const blocked = result.risks.filter((item) => item.kind === "blocked");

    expect(blocked).toHaveLength(1);
    expect(blocked[0].itemId).toBe("#142");
    expect(blocked[0].evidenceIds).toEqual(["#142", "#139"]);
  });

  it("detects stale active work at the configured threshold", () => {
    const result = analyzeSprint(mondaySnapshot, currentSnapshot, 3);
    const stale = result.risks.filter((item) => item.kind === "stale");

    expect(stale.map((item) => item.itemId)).toEqual(["#128"]);
  });

  it("answers blocker questions from computed evidence", () => {
    const result = analyzeSprint(mondaySnapshot, currentSnapshot);
    const answer = answerSprintQuestion("What is blocked?", result);

    expect(answer).toContain("#142");
    expect(answer).toContain("#139");
  });

  it("builds a holiday catch-up brief from changes, risks, and exact events", () => {
    const result = analyzeSprint(mondaySnapshot, currentSnapshot);
    const answer = answerSprintQuestion(
      "Give me a holiday catch up",
      result,
      demoActivityEvents,
    );

    expect(answer).toContain("Catch-up brief");
    expect(answer).toContain("1 new comment");
    expect(answer).toContain("1 review");
    expect(evidenceForSprintQuestion("holiday catch up", result, demoActivityEvents))
      .toHaveLength(2);
  });

  it("turns exact comment and review events into source-linked changes", () => {
    const changes = activityEventsToChanges(demoActivityEvents);

    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "comments", itemId: "#142" }),
        expect.objectContaining({ kind: "review", itemId: "#139" }),
      ]),
    );
    expect(changes.every((change) => change.evidenceUrl.includes("github.com"))).toBe(
      true,
    );
  });
});
