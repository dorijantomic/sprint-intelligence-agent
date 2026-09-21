import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createApiServer } from "./server.js";
import { seedDemoLedger } from "../fixtures/seed-demo.js";
import { SprintLedger } from "../ledger/ledger.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const port = Number(process.env.PORT ?? 8787);
const databasePath = resolve(
  process.env.SPRINT_LEDGER_PATH ?? ".data/sprint-intelligence.sqlite",
);
mkdirSync(dirname(databasePath), { recursive: true });

const ledger = new SprintLedger(databasePath);
seedDemoLedger(ledger);
const server = createApiServer(ledger);

server.listen(port, "127.0.0.1", () => {
  console.log(`Sprint Intelligence API listening on http://127.0.0.1:${port}`);
});

function shutdown(): void {
  server.close(() => {
    ledger.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
