import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runEvaluationSuite } from "./evaluate.js";

const report = runEvaluationSuite();
const reportDirectory = resolve(".artifacts");
const reportPath = resolve(reportDirectory, "eval-report.json");
await mkdir(reportDirectory, { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Sprint Intelligence evals: ${report.passed ? "PASS" : "FAIL"}`);
console.log(
  `${report.metrics.scenarios} scenarios · ${report.metrics.passedAssertions}/${report.metrics.assertions} assertions · ${report.durationMs} ms`,
);
console.log(
  `Factual correctness ${(report.metrics.factualCorrectness * 100).toFixed(1)}% · citation coverage ${(report.metrics.citationCoverage * 100).toFixed(1)}% · unsupported claim rate ${(report.metrics.unsupportedClaimRate * 100).toFixed(1)}%`,
);
console.log(`Report: ${reportPath}`);

if (!report.passed) {
  for (const scenario of report.scenarios) {
    for (const item of scenario.assertions.filter((assertion) => !assertion.passed)) {
      console.error(
        `[${scenario.id}] ${item.name}: expected ${JSON.stringify(item.expected)}, received ${JSON.stringify(item.actual)}`,
      );
    }
  }
  process.exitCode = 1;
}
