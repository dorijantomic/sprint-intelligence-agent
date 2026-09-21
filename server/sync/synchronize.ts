import type { SourceConnector } from "../connectors/types.js";
import { SprintLedger } from "../ledger/ledger.js";

export interface SyncSummary {
  batches: number;
  items: number;
  eventsAdded: number;
  relationships: number;
  cursor: string | null;
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
  const summary: SyncSummary = {
    batches: 0,
    items: 0,
    eventsAdded: 0,
    relationships: 0,
    cursor: startingCursor,
  };

  for await (const batch of connector.pull(startingCursor)) {
    ledger.transaction(() => {
      if (batch.iteration) ledger.upsertIteration(connectionId, batch.iteration);
      for (const item of batch.items) ledger.upsertWorkItem(connectionId, item);
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

  return summary;
}
