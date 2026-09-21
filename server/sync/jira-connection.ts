import { JiraSprintConnector } from "../connectors/jira-sprint.js";
import { SprintLedger } from "../ledger/ledger.js";
import { synchronize, type SyncSummary } from "./synchronize.js";

export interface JiraConnectionConfig extends Record<string, unknown> {
  baseUrl: string;
  email: string;
  sprintId: number;
  sprintName: string;
  storyPointField: string | null;
}

export interface JiraConnectionSyncResult {
  summary: SyncSummary;
  snapshotId: string;
  snapshotCreated: boolean;
  snapshotItems: number;
}

export async function syncJiraConnection(
  ledger: SprintLedger,
  config: JiraConnectionConfig,
  apiToken: string,
  request: typeof fetch = fetch,
): Promise<JiraConnectionSyncResult> {
  const connector = new JiraSprintConnector({
    ...config,
    apiToken,
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
    String(config.sprintId),
  );
  return {
    summary,
    snapshotId: snapshot.snapshot.id,
    snapshotCreated: snapshot.created,
    snapshotItems: snapshot.snapshot.items.length,
  };
}
