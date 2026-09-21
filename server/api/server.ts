import { createServer, type Server, type ServerResponse } from "node:http";
import { serializeSnapshot } from "./dashboard.js";
import { SprintLedger } from "../ledger/ledger.js";
import { runEvaluationSuite } from "../evals/evaluate.js";

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

export function createApiServer(ledger: SprintLedger): Server {
  return createServer((request, response) => {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/api/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (url.pathname === "/api/dashboard") {
      const snapshots = ledger.getRecentSnapshots(2);
      if (snapshots.length < 2) {
        sendJson(response, 409, {
          error: "At least two sprint snapshots are required",
        });
        return;
      }
      const evaluation = runEvaluationSuite();
      sendJson(response, 200, {
        baseline: serializeSnapshot(snapshots[1]),
        current: serializeSnapshot(snapshots[0]),
        events: ledger.getEventsBetweenSnapshots(
          snapshots[1].id,
          snapshots[0].id,
        ),
        syncMetrics: ledger.getLatestSyncRunForSnapshot(snapshots[0].id),
        qualityMetrics: {
          factualCorrectness: evaluation.metrics.factualCorrectness,
          citationCoverage: evaluation.metrics.citationCoverage,
          unsupportedClaimRate: evaluation.metrics.unsupportedClaimRate,
          scenarios: evaluation.metrics.scenarios,
          assertions: evaluation.metrics.assertions,
          durationMs: evaluation.durationMs,
          passed: evaluation.passed,
        },
        source: "ledger",
      });
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  });
}
