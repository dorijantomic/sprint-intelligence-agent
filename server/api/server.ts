import { createServer, type Server, type ServerResponse } from "node:http";
import { serializeSnapshot } from "./dashboard.js";
import { SprintLedger } from "../ledger/ledger.js";

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
      sendJson(response, 200, {
        baseline: serializeSnapshot(snapshots[1]),
        current: serializeSnapshot(snapshots[0]),
        source: "ledger",
      });
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  });
}
