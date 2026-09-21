import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runSprintAgent } from "../agent/run-agent.js";
import { resolveAgentRuntime } from "../agent/runtime/config.js";
import { seedDemoLedger } from "../fixtures/seed-demo.js";
import { SprintLedger } from "../ledger/ledger.js";
import { mondaySnapshot } from "../../src/data/demoSprint.js";

interface LiveScenario {
  id: string;
  question: string;
  expectedTools: string[];
  expectedEvidence: string[];
}

const scenarios: LiveScenario[] = [
  {
    id: "blocked-chain",
    question: "What is blocked, and what is it blocked by?",
    expectedTools: ["list_sprint_risks"],
    expectedEvidence: ["work-item:#142", "work-item:#139"],
  },
  {
    id: "temporal-change",
    question: "What changed since Monday?",
    expectedTools: ["list_sprint_changes"],
    expectedEvidence: ["work-item:#147"],
  },
  {
    id: "holiday-brief",
    question: "Give me a holiday catch-up brief with risks and new activity.",
    expectedTools: [
      "list_sprint_changes",
      "list_sprint_risks",
    ],
    expectedEvidence: ["work-item:#142"],
  },
];

function tokenCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  if (provider === "google-gemini" && model === "gemini-3.8-flash") {
    return (inputTokens * 0.75 + outputTokens * 3.75) / 1_000_000;
  }
  if (provider === "opencode-go" && model === "gpt-5.6-luna") {
    return (inputTokens * 0.2 + outputTokens * 1.2) / 1_000_000;
  }
  const inputRate = Number(process.env.AGENT_INPUT_COST_PER_MILLION);
  const outputRate = Number(process.env.AGENT_OUTPUT_COST_PER_MILLION);
  if (!Number.isFinite(inputRate) || !Number.isFinite(outputRate)) return null;
  return (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000;
}

async function main(): Promise<void> {
  if (!process.argv.includes("--confirm-cost")) {
    throw new Error(
      "Live evals make paid provider calls. Re-run with --confirm-cost to continue.",
    );
  }
  const runtime = await resolveAgentRuntime();
  if (!runtime) throw new Error("Configure an AI provider before running live evals");
  const scenarioFlag = process.argv.indexOf("--scenario");
  const selectedScenarios = scenarioFlag >= 0
    ? scenarios.filter((scenario) => scenario.id === process.argv[scenarioFlag + 1])
    : scenarios;
  if (selectedScenarios.length === 0) throw new Error("Unknown live eval scenario");

  const results = [];
  for (const scenario of selectedScenarios) {
    const ledger = new SprintLedger();
    try {
      seedDemoLedger(ledger);
      const answer = await runSprintAgent(ledger, scenario.question, {
        runtime,
        since: mondaySnapshot.capturedAt,
      });
      const tools = answer.toolsUsed.map((tool) => tool.name);
      const evidence = answer.evidence.map((item) => item.id);
      const checks = {
        stayedInAgentMode: answer.mode === "agent" && answer.fallbackReason === null,
        selectedExpectedTools: scenario.expectedTools.every((tool) =>
          tools.includes(tool),
        ),
        returnedExpectedEvidence: scenario.expectedEvidence.every((id) =>
          evidence.includes(id),
        ),
        everyClaimGrounded:
          answer.claims.length > 0 &&
          answer.claims.every(
            (claim) => claim.factIds.length > 0 && claim.evidenceIds.length > 0,
          ),
      };
      results.push({
        id: scenario.id,
        question: scenario.question,
        passed: Object.values(checks).every(Boolean),
        checks,
        answer,
      });
    } finally {
      ledger.close();
    }
  }

  const inputTokens = results.reduce(
    (sum, result) => sum + result.answer.telemetry.inputTokens,
    0,
  );
  const outputTokens = results.reduce(
    (sum, result) => sum + result.answer.telemetry.outputTokens,
    0,
  );
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    provider: runtime.provider,
    model: runtime.model,
    passed: results.every((result) => result.passed),
    metrics: {
      scenarios: results.length,
      passedScenarios: results.filter((result) => result.passed).length,
      totalDurationMs: results.reduce(
        (sum, result) => sum + result.answer.telemetry.durationMs,
        0,
      ),
      modelCalls: results.reduce(
        (sum, result) => sum + result.answer.telemetry.modelCalls,
        0,
      ),
      inputTokens,
      outputTokens,
      estimatedCostUsd: tokenCost(
        runtime.provider,
        runtime.model,
        inputTokens,
        outputTokens,
      ),
      groundedClaimRate:
        results.filter((result) => result.checks.everyClaimGrounded).length /
        results.length,
      expectedToolSelectionRate:
        results.filter((result) => result.checks.selectedExpectedTools).length /
        results.length,
    },
    results,
  };
  const reportPath = resolve(".artifacts/live-eval-report.json");
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    `Live agent evals: ${report.passed ? "PASS" : "FAIL"}\n` +
      `${report.metrics.passedScenarios}/${report.metrics.scenarios} scenarios · ` +
      `${report.metrics.modelCalls} model calls · ` +
      `${Math.round(report.metrics.totalDurationMs)} ms · ` +
      `${inputTokens + outputTokens} tokens\n` +
      `Estimated cost: ${report.metrics.estimatedCostUsd === null ? "not configured" : `$${report.metrics.estimatedCostUsd.toFixed(6)}`}\n` +
      `Report: ${reportPath}`,
  );
  if (!report.passed) process.exitCode = 1;
}

await main();
