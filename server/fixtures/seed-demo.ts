import { currentSnapshot, mondaySnapshot } from "../../src/data/demoSprint.js";
import type { WorkItem } from "../../src/domain/types.js";
import { SprintLedger } from "../ledger/ledger.js";

const connectionExternalId = "fixture/acme-checkout";
const iterationExternalId = "checkout-sprint-42";

function storeItems(
  ledger: SprintLedger,
  connectionId: number,
  items: WorkItem[],
): void {
  for (const item of items) {
    ledger.upsertWorkItem(connectionId, {
      externalId: `fixture:${item.id}`,
      iterationExternalId,
      key: item.id,
      title: item.title,
      kind: item.type,
      status: item.status,
      priority: item.priority,
      assignee: item.assignee,
      estimate: item.estimate,
      commentCount: item.commentCount,
      reviewState: item.reviewState,
      updatedAt: item.updatedAt,
      url: item.url,
      raw: item,
    });
  }
}

function storeRelationships(
  ledger: SprintLedger,
  connectionId: number,
  items: WorkItem[],
  observedAt: string,
): void {
  for (const item of items) {
    for (const blocker of item.blockedBy) {
      ledger.applyRelationship(connectionId, {
        action: "upsert",
        fromExternalId: `fixture:${item.id}`,
        toExternalId: `fixture:${blocker}`,
        kind: "blocked_by",
        observedAt,
      });
    }
  }
}

export function seedDemoLedger(ledger: SprintLedger): void {
  if (ledger.count("sprint_snapshots") >= 2) return;

  const connectionId = ledger.upsertConnection(
    "fixture",
    connectionExternalId,
    "ACME Checkout demo",
  );
  ledger.upsertIteration(connectionId, {
    externalId: iterationExternalId,
    name: currentSnapshot.sprintName,
    goal: "Stabilize checkout before the seasonal traffic increase",
    startsAt: "2026-09-14T09:00:00Z",
    endsAt: "2026-09-25T17:00:00Z",
    raw: { fixture: true },
  });
  ledger.recordSyncRun(connectionId, {
    startedAt: "2026-09-18T16:29:59.950Z",
    completedAt: "2026-09-18T16:30:00.000Z",
    durationMs: 50,
    status: "succeeded",
    requestCount: 1,
    batches: 1,
    items: currentSnapshot.items.length,
    eventsAdded: 2,
    relationships: 1,
    errorMessage: null,
  });

  storeItems(ledger, connectionId, mondaySnapshot.items);
  storeRelationships(
    ledger,
    connectionId,
    mondaySnapshot.items,
    mondaySnapshot.capturedAt,
  );
  ledger.createSnapshot(
    connectionId,
    iterationExternalId,
    mondaySnapshot.capturedAt,
  );

  storeItems(ledger, connectionId, currentSnapshot.items);
  ledger.appendEvent(connectionId, {
    externalId: "fixture-comment-142",
    workItemExternalId: "fixture:#142",
    kind: "commented",
    occurredAt: "2026-09-18T10:05:00Z",
    actor: "Maya",
    url: "https://github.com/acme/checkout/issues/142#issuecomment-demo",
    payload: {
      body: "Payment retries still depend on the idempotency changes in #139.",
      source: "fixture",
    },
  });
  ledger.appendEvent(connectionId, {
    externalId: "fixture-review-139",
    workItemExternalId: "fixture:#139",
    kind: "reviewed",
    occurredAt: "2026-09-18T09:28:00Z",
    actor: "Iris",
    url: "https://github.com/acme/checkout/pull/139#pullrequestreview-demo",
    payload: {
      body: "Please cover the timeout path before merge.",
      state: "changes_requested",
      source: "fixture",
    },
  });
  storeRelationships(
    ledger,
    connectionId,
    currentSnapshot.items,
    currentSnapshot.capturedAt,
  );
  ledger.createSnapshot(
    connectionId,
    iterationExternalId,
    currentSnapshot.capturedAt,
  );
}
