import {
  analyzeSprint,
  answerSprintQuestion,
  evidenceForSprintQuestion,
} from "../../src/domain/analyzeSprint.js";
import type { ChangeKind } from "../../src/domain/types.js";
import { evalScenarios } from "./scenarios.js";
import type {
  EvalAssertion,
  EvalAssertionCategory,
  EvalReport,
  EvalScenario,
  EvalScenarioResult,
} from "./types.js";

const thresholds = {
  factualCorrectness: 1,
  citationCoverage: 1,
  maximumUnsupportedClaimRate: 0,
} as const;

function assertion(
  category: EvalAssertionCategory,
  name: string,
  expected: unknown,
  actual: unknown,
  passed: boolean,
): EvalAssertion {
  return { category, name, expected, actual, passed };
}

export function evaluateScenario(scenario: EvalScenario): EvalScenarioResult {
  const analysis = analyzeSprint(scenario.baseline, scenario.current);
  const assertions: EvalAssertion[] = [];
  const counts = analysis.changes.reduce<Partial<Record<ChangeKind, number>>>(
    (result, change) => {
      result[change.kind] = (result[change.kind] ?? 0) + 1;
      return result;
    },
    {},
  );

  for (const [kind, expectedCount] of Object.entries(
    scenario.expected.changeCounts,
  )) {
    const actual = counts[kind as ChangeKind] ?? 0;
    assertions.push(
      assertion(
        "fact",
        `change count: ${kind}`,
        expectedCount,
        actual,
        actual === expectedCount,
      ),
    );
  }

  for (const expectedRisk of scenario.expected.risks) {
    const matching = analysis.risks.find(
      (risk) =>
        risk.itemId === expectedRisk.itemId && risk.kind === expectedRisk.kind,
    );
    const actual = matching
      ? { itemId: matching.itemId, kind: matching.kind, severity: matching.severity }
      : null;
    const severityMatches =
      expectedRisk.severity === undefined ||
      matching?.severity === expectedRisk.severity;
    assertions.push(
      assertion(
        "fact",
        `risk: ${expectedRisk.itemId} ${expectedRisk.kind}`,
        expectedRisk,
        actual,
        matching !== undefined && severityMatches,
      ),
    );
  }

  for (const [name, expected, actual] of [
    ["risk total", scenario.expected.riskCount, analysis.risks.length],
    ["completed total", scenario.expected.completedCount, analysis.completedCount],
    ["scope additions", scenario.expected.addedCount, analysis.addedCount],
    ["active total", scenario.expected.activeCount, analysis.activeCount],
  ] as const) {
    assertions.push(assertion("fact", name, expected, actual, expected === actual));
  }

  for (const expectedAnswer of scenario.expected.answers) {
    const answer = answerSprintQuestion(
      expectedAnswer.question,
      analysis,
      scenario.events,
    );
    const evidence = evidenceForSprintQuestion(
      expectedAnswer.question,
      analysis,
      scenario.events,
    );

    for (const expectedText of expectedAnswer.includes) {
      assertions.push(
        assertion(
          "fact",
          `answer includes: ${expectedAnswer.question} → ${expectedText}`,
          expectedText,
          answer,
          answer.includes(expectedText),
        ),
      );
    }
    for (const unsupportedText of expectedAnswer.excludes ?? []) {
      assertions.push(
        assertion(
          "unsupported_claim",
          `answer excludes: ${expectedAnswer.question} → ${unsupportedText}`,
          `not ${unsupportedText}`,
          answer,
          !answer.includes(unsupportedText),
        ),
      );
    }
    const requiresEvidence = expectedAnswer.minimumEvidence > 0;
    assertions.push(
      assertion(
        requiresEvidence ? "citation" : "fact",
        `evidence count: ${expectedAnswer.question}`,
        requiresEvidence ? `>= ${expectedAnswer.minimumEvidence}` : 0,
        evidence.length,
        requiresEvidence
          ? evidence.length >= expectedAnswer.minimumEvidence &&
              evidence.every((item) => item.url.startsWith("https://"))
          : evidence.length === 0,
      ),
    );
  }

  return {
    id: scenario.id,
    description: scenario.description,
    passed: assertions.every((item) => item.passed),
    assertions,
  };
}

function passRate(assertions: EvalAssertion[]): number {
  if (assertions.length === 0) return 1;
  return assertions.filter((item) => item.passed).length / assertions.length;
}

export function runEvaluationSuite(
  scenarios: EvalScenario[] = evalScenarios,
): EvalReport {
  const startedAt = performance.now();
  const results = scenarios.map(evaluateScenario);
  const assertions = results.flatMap((result) => result.assertions);
  const facts = assertions.filter((item) => item.category === "fact");
  const citations = assertions.filter((item) => item.category === "citation");
  const unsupportedClaims = assertions.filter(
    (item) => item.category === "unsupported_claim",
  );
  const factualCorrectness = passRate(facts);
  const citationCoverage = passRate(citations);
  const unsupportedClaimRate = 1 - passRate(unsupportedClaims);
  const passed =
    factualCorrectness >= thresholds.factualCorrectness &&
    citationCoverage >= thresholds.citationCoverage &&
    unsupportedClaimRate <= thresholds.maximumUnsupportedClaimRate &&
    results.every((result) => result.passed);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    durationMs: Number((performance.now() - startedAt).toFixed(2)),
    passed,
    thresholds,
    metrics: {
      scenarios: results.length,
      assertions: assertions.length,
      passedAssertions: assertions.filter((item) => item.passed).length,
      factualCorrectness,
      citationCoverage,
      unsupportedClaimRate,
      modelCalls: 0,
      estimatedCostUsd: 0,
    },
    scenarios: results,
  };
}
