import { afterEach, describe, expect, it } from "vitest";
import type {
  ConnectorBatch,
  SourceConnector,
} from "../connectors/types.js";
import { synchronize } from "../sync/synchronize.js";
import { SprintLedger } from "./ledger.js";

const batch: ConnectorBatch = {
  iteration: {
    externalId: "iteration-42",
    name: "Sprint 42",
    goal: "Stabilize checkout",
    startsAt: "2026-09-14T09:00:00Z",
    endsAt: "2026-09-25T17:00:00Z",
    raw: { source: "fixture" },
  },
  items: [
    {
      externalId: "item-139",
      iterationExternalId: "iteration-42",
      key: "#139",
      title: "Expose idempotency keys",
      kind: "pull_request",
      status: "in_review",
      priority: "high",
      assignee: "Leo",
      estimate: 5,
      commentCount: 3,
      reviewState: "pending",
      updatedAt: "2026-09-18T09:28:00Z",
      url: "https://example.test/pull/139",
      raw: { number: 139 },
    },
    {
      externalId: "item-142",
      iterationExternalId: "iteration-42",
      key: "#142",
      title: "Retry payment authorization",
      kind: "issue",
      status: "in_progress",
      priority: "urgent",
      assignee: "Maya",
      estimate: 8,
      commentCount: 7,
      reviewState: "none",
      updatedAt: "2026-09-18T10:05:00Z",
      url: "https://example.test/issues/142",
      raw: { number: 142 },
    },
  ],
  relationships: [
    {
      action: "upsert",
      fromExternalId: "item-142",
      toExternalId: "item-139",
      kind: "blocked_by",
      observedAt: "2026-09-18T10:05:00Z",
    },
  ],
  events: [
    {
      externalId: "event-1",
      workItemExternalId: "item-142",
      kind: "commented",
      occurredAt: "2026-09-18T10:05:00Z",
      actor: "Maya",
      url: "https://example.test/issues/142#comment-1",
      payload: { body: "Still waiting on #139" },
    },
  ],
  cursor: "cursor-1",
};

class FixtureConnector implements SourceConnector {
  readonly provider = "fixture";
  readonly connectionExternalId = "fixture/acme-checkout";
  readonly displayName = "ACME Checkout";

  async *pull(): AsyncIterable<ConnectorBatch> {
    yield batch;
  }
}

describe("SprintLedger", () => {
  let ledger: SprintLedger | undefined;

  afterEach(() => ledger?.close());

  it("persists normalized connector data and a checkpoint", async () => {
    ledger = new SprintLedger();
    const result = await synchronize(ledger, new FixtureConnector());

    expect(result).toEqual({
      batches: 1,
      items: 2,
      eventsAdded: 1,
      relationships: 1,
      cursor: "cursor-1",
    });
    expect(ledger.count("source_connections")).toBe(1);
    expect(ledger.count("iterations")).toBe(1);
    expect(ledger.count("work_items")).toBe(2);
    expect(ledger.count("work_item_relationships")).toBe(1);
    expect(ledger.count("activity_events")).toBe(1);
  });

  it("is idempotent when the same provider data is synchronized twice", async () => {
    ledger = new SprintLedger();
    const connector = new FixtureConnector();

    await synchronize(ledger, connector);
    const second = await synchronize(ledger, connector);

    expect(second.eventsAdded).toBe(0);
    expect(ledger.count("source_connections")).toBe(1);
    expect(ledger.count("work_items")).toBe(2);
    expect(ledger.count("work_item_relationships")).toBe(1);
    expect(ledger.count("activity_events")).toBe(1);
  });

  it("removes blocker relationships that are absent from a later observation", async () => {
    ledger = new SprintLedger();
    await synchronize(ledger, new FixtureConnector());

    class ClearedRelationshipConnector extends FixtureConnector {
      override async *pull(): AsyncIterable<ConnectorBatch> {
        yield {
          ...batch,
          relationships: [],
          relationshipResets: [
            { fromExternalId: "item-142", kind: "blocked_by" },
          ],
          cursor: "cursor-2",
        };
      }
    }

    await synchronize(ledger, new ClearedRelationshipConnector());

    expect(ledger.count("work_item_relationships")).toBe(0);
  });

  it("creates immutable iteration snapshots", async () => {
    ledger = new SprintLedger();
    const connector = new FixtureConnector();
    await synchronize(ledger, connector);
    const connectionId = ledger.upsertConnection(
      connector.provider,
      connector.connectionExternalId,
      connector.displayName,
    );

    const snapshot = ledger.createSnapshot(
      connectionId,
      "iteration-42",
      "2026-09-18T16:30:00Z",
    );

    expect(snapshot.iterationName).toBe("Sprint 42");
    expect(snapshot.sourceName).toBe("ACME Checkout");
    expect(snapshot.capturedAt).toBe("2026-09-18T16:30:00Z");
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items).toContainEqual(
      expect.objectContaining({ item_key: "#142", blocked_by: ["#139"] }),
    );
    expect(ledger.count("sprint_snapshots")).toBe(1);
  });
});
