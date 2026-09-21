import { GitHubProjectConnector } from "../connectors/github-project.js";
import { SprintLedger } from "../ledger/ledger.js";
import { synchronize, type SyncSummary } from "./synchronize.js";

export interface GitHubConnectionConfig extends Record<string, unknown> {
  owner: string;
  projectNumber: number;
  projectTitle: string;
  projectUrl: string;
  iterationId: string;
  iterationTitle: string;
}

export interface GitHubConnectionSyncResult {
  summary: SyncSummary;
  snapshotId: string;
  snapshotCreated: boolean;
  snapshotItems: number;
}

export async function syncGitHubConnection(
  ledger: SprintLedger,
  config: GitHubConnectionConfig,
  token: string,
  request: typeof fetch = fetch,
): Promise<GitHubConnectionSyncResult> {
  const connector = new GitHubProjectConnector({
    owner: config.owner,
    projectNumber: config.projectNumber,
    iterationId: config.iterationId,
    projectTitle: config.projectTitle,
    token,
    fetch: request,
  });
  const summary = await synchronize(ledger, connector);
  const connectionId = ledger.upsertConnection(
    connector.provider,
    connector.connectionExternalId,
    connector.displayName,
  );
  const snapshot = ledger.createSnapshotIfChanged(
    connectionId,
    config.iterationId,
  );

  return {
    summary,
    snapshotId: snapshot.snapshot.id,
    snapshotCreated: snapshot.created,
    snapshotItems: snapshot.snapshot.items.length,
  };
}
