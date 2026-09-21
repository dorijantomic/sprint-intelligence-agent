import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  readGitHubSyncConfig,
  resolveGitHubToken,
} from "../config/github-sync.js";
import { GitHubProjectConnector } from "../connectors/github-project.js";
import { SprintLedger } from "../ledger/ledger.js";
import { synchronize } from "../sync/synchronize.js";

if (existsSync(".env")) process.loadEnvFile(".env");

async function main(): Promise<void> {
  const config = readGitHubSyncConfig(process.env);
  const token = resolveGitHubToken(config.token);
  const databasePath = resolve(config.databasePath);
  mkdirSync(dirname(databasePath), { recursive: true });
  const ledger = new SprintLedger(databasePath);

  try {
    const connector = new GitHubProjectConnector({
      owner: config.owner,
      projectNumber: config.projectNumber,
      iterationId: config.iterationId,
      token,
    });
    const summary = await synchronize(ledger, connector);
    const connectionId = ledger.upsertConnection(
      connector.provider,
      connector.connectionExternalId,
      connector.displayName,
    );
    const snapshotResult = ledger.createSnapshotIfChanged(
      connectionId,
      config.iterationId,
      new Date().toISOString(),
    );
    const snapshot = snapshotResult.snapshot;

    console.log(
      JSON.stringify(
        {
          connection: connector.connectionExternalId,
          databasePath,
          synchronizedItems: summary.items,
          newEvents: summary.eventsAdded,
          durationMs: summary.durationMs,
          apiRequests: summary.requestCount,
          snapshotId: snapshot.id,
          snapshotCreated: snapshotResult.created,
          snapshotItems: snapshot.items.length,
        },
        null,
        2,
      ),
    );
  } finally {
    ledger.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown sync failure";
  console.error(`GitHub synchronization failed: ${message}`);
  process.exitCode = 1;
});
