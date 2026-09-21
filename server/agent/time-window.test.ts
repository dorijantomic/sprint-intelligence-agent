import { describe, expect, it } from "vitest";
import { resolveQuestionSince } from "./time-window.js";

describe("resolveQuestionSince", () => {
  const wednesday = new Date("2026-09-23T12:00:00.000Z");

  it("resolves Monday relative to the current local week", () => {
    const result = resolveQuestionSince("What changed since Monday?", null, wednesday);
    expect(result?.slice(0, 10)).toBe("2026-09-21");
  });

  it("resolves relative day windows", () => {
    expect(resolveQuestionSince("What changed in the last 7 days?", null, wednesday))
      .toBe("2026-09-16T12:00:00.000Z");
  });

  it("prefers an explicit UI timestamp", () => {
    expect(
      resolveQuestionSince(
        "What changed since Monday?",
        "2026-09-20T08:30:00.000Z",
        wednesday,
      ),
    ).toBe("2026-09-20T08:30:00.000Z");
  });
});
