import { describe, expect, it } from "vitest";
import { evaluateScenario, runEvaluationSuite } from "./evaluate.js";
import { evalScenarios } from "./scenarios.js";

describe("sprint evaluation gate", () => {
  it("passes the versioned regression scenarios", () => {
    const report = runEvaluationSuite();

    expect(report.passed).toBe(true);
    expect(report.metrics.scenarios).toBe(3);
    expect(report.metrics.factualCorrectness).toBe(1);
    expect(report.metrics.citationCoverage).toBe(1);
    expect(report.metrics.unsupportedClaimRate).toBe(0);
    expect(report.metrics.modelCalls).toBe(0);
  });

  it("reports the exact assertion when an expectation regresses", () => {
    const original = evalScenarios[0];
    const result = evaluateScenario({
      ...original,
      expected: { ...original.expected, riskCount: 999 },
    });

    expect(result.passed).toBe(false);
    expect(result.assertions).toContainEqual(
      expect.objectContaining({
        name: "risk total",
        expected: 999,
        passed: false,
      }),
    );
  });
});
