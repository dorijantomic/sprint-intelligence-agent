import { JiraSprintConnector } from "../connectors/jira-sprint.js";
import { SprintLedger } from "../ledger/ledger.js";
import { synchronize, type SyncSummary } from "./synchronize.js";

export interface JiraConnectionConfig extends Record<string, unknown> {
  baseUrl: string;
  authMode?: "api_token" | "oauth";
  email?: string;
  cloudId?: string;
  sprintId: number;
  sprintName: string;
  storyPointField: string | null;
}

export type JiraCredential =
  | { type: "api_token"; apiToken: string }
  | { type: "oauth"; accessToken: string; cloudId: string };

export interface JiraConnectionSyncResult {
  summary: SyncSummary;
  snapshotId: string;
  snapshotCreated: boolean;
  snapshotItems: number;
}

export async function syncJiraConnection(
  ledger: SprintLedger,
  config: JiraConnectionConfig,
  credential: JiraCredential,
  request: typeof fetch = fetch,
): Promise<JiraConnectionSyncResult> {
  const connector = credential.type === "oauth"
    ? new JiraSprintConnector({
        baseUrl: config.baseUrl,
        sprintId: config.sprintId,
        sprintName: config.sprintName,
        storyPointField: config.storyPointField,
        accessToken: credential.accessToken,
        apiBaseUrl: `https://api.atlassian.com/ex/jira/${encodeURIComponent(credential.cloudId)}`,
        fetch: request,
      })
    : new JiraSprintConnector({
        baseUrl: config.baseUrl,
        sprintId: config.sprintId,
        sprintName: config.sprintName,
        storyPointField: config.storyPointField,
        email: config.email ?? "",
        apiToken: credential.apiToken,
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
