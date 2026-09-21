import type { SourceConnector } from "../connectors/types.js";
import { SprintLedger } from "../ledger/ledger.js";

export interface SyncSummary {
  batches: number;
  items: number;
  eventsAdded: number;
  relationships: number;
  cursor: string | null;
  durationMs: number;
  requestCount: number;
}

export async function synchronize(
  ledger: SprintLedger,
  connector: SourceConnector,
): Promise<SyncSummary> {
  const connectionId = ledger.upsertConnection(
    connector.provider,
    connector.connectionExternalId,
    connector.displayName,
  );
  const startingCursor = ledger.getCheckpoint(connectionId);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const summary: SyncSummary = {
    batches: 0,
    items: 0,
    eventsAdded: 0,
    relationships: 0,
    cursor: startingCursor,
    durationMs: 0,
    requestCount: 0,
  };

  try {
    for await (const batch of connector.pull(startingCursor)) {
      ledger.transaction(() => {
        if (batch.iteration) ledger.upsertIteration(connectionId, batch.iteration);
        for (const item of batch.items) ledger.upsertWorkItem(connectionId, item);
        for (const reset of batch.relationshipResets ?? []) {
          ledger.clearRelationshipsFrom(
            connectionId,
            reset.fromExternalId,
            reset.kind,
          );
        }
        for (const relationship of batch.relationships) {
          ledger.applyRelationship(connectionId, relationship);
        }
        for (const event of batch.events) {
          if (ledger.appendEvent(connectionId, event)) summary.eventsAdded += 1;
        }
        ledger.saveCheckpoint(connectionId, batch.cursor);
      });

      summary.batches += 1;
      summary.items += batch.items.length;
      summary.relationships += batch.relationships.length;
      summary.cursor = batch.cursor;
    }

    summary.durationMs = Number((performance.now() - started).toFixed(2));
    summary.requestCount = connector.requestCount ?? 0;
    ledger.recordSyncRun(connectionId, {
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: summary.durationMs,
      status: "succeeded",
      requestCount: summary.requestCount,
      batches: summary.batches,
      items: summary.items,
      eventsAdded: summary.eventsAdded,
      relationships: summary.relationships,
      errorMessage: null,
    });
  } catch (error) {
    summary.durationMs = Number((performance.now() - started).toFixed(2));
    summary.requestCount = connector.requestCount ?? 0;
    ledger.recordSyncRun(connectionId, {
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: summary.durationMs,
      status: "failed",
      requestCount: summary.requestCount,
      batches: summary.batches,
      items: summary.items,
      eventsAdded: summary.eventsAdded,
      relationships: summary.relationships,
      errorMessage: error instanceof Error ? error.message : "Unknown sync failure",
    });
    throw error;
  }

  return summary;
}
