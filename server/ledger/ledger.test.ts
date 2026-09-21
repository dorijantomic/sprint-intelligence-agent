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
      durationMs: expect.any(Number),
      requestCount: 0,
    });
    expect(ledger.count("source_connections")).toBe(1);
    expect(ledger.count("iterations")).toBe(1);
    expect(ledger.count("work_items")).toBe(2);
    expect(ledger.count("work_item_relationships")).toBe(1);
    expect(ledger.count("activity_events")).toBe(1);
    expect(ledger.count("sync_runs")).toBe(1);
  });

  it("persists provider configuration without credentials", () => {
    ledger = new SprintLedger();
    const saved = ledger.saveConnectionConfig(
      "github",
      "maya/projects/1",
      "maya · Delivery",
      {
        owner: "maya",
        projectNumber: 1,
        iterationId: "iteration-2",
      },
    );

    expect(ledger.getConnectionConfig(saved.id)).toEqual(
      expect.objectContaining({
        provider: "github",
        externalId: "maya/projects/1",
        config: {
          owner: "maya",
          projectNumber: 1,
          iterationId: "iteration-2",
        },
      }),
    );
    expect(JSON.stringify(ledger.getConnectionConfigs())).not.toContain("token");
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
    expect(ledger.count("sync_runs")).toBe(2);
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

  it("does not create a duplicate snapshot when sprint state is unchanged", async () => {
    ledger = new SprintLedger();
    const connector = new FixtureConnector();
    await synchronize(ledger, connector);
    const connectionId = ledger.upsertConnection(
      connector.provider,
      connector.connectionExternalId,
      connector.displayName,
    );

    const first = ledger.createSnapshotIfChanged(
      connectionId,
      "iteration-42",
      "2026-09-18T16:30:00Z",
    );
    const second = ledger.createSnapshotIfChanged(
      connectionId,
      "iteration-42",
      "2026-09-18T16:31:00Z",
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.snapshot.id).toBe(first.snapshot.id);
    expect(ledger.count("sprint_snapshots")).toBe(1);
  });

  it("records failed connector runs before rethrowing the error", async () => {
    ledger = new SprintLedger();

    class FailingConnector extends FixtureConnector {
      override async *pull(): AsyncIterable<ConnectorBatch> {
        throw new Error("fixture connection failed");
      }
    }

    await expect(synchronize(ledger, new FailingConnector())).rejects.toThrow(
      "fixture connection failed",
    );
    const run = ledger.database
      .prepare("SELECT status, error_message FROM sync_runs LIMIT 1")
      .get() as unknown as { status: string; error_message: string };

    expect(run).toEqual({
      status: "failed",
      error_message: "fixture connection failed",
    });
  });

  it("returns exact activity evidence between two snapshots", async () => {
    ledger = new SprintLedger();
    const connector = new FixtureConnector();
    await synchronize(ledger, connector);
    const connectionId = ledger.upsertConnection(
      connector.provider,
      connector.connectionExternalId,
      connector.displayName,
    );
    const baseline = ledger.createSnapshot(
      connectionId,
      "iteration-42",
      "2026-09-18T09:00:00Z",
    );
    const current = ledger.createSnapshot(
      connectionId,
      "iteration-42",
      "2026-09-18T11:00:00Z",
    );

    const events = ledger.getEventsBetweenSnapshots(baseline.id, current.id);

    expect(events).toEqual([
      expect.objectContaining({
        id: "event-1",
        itemId: "#142",
        kind: "commented",
        actor: "Maya",
      }),
    ]);
  });

  it("selects the snapshot at or before a requested comparison time", async () => {
    ledger = new SprintLedger();
    const connector = new FixtureConnector();
    await synchronize(ledger, connector);
    const connectionId = ledger.upsertConnection(
      connector.provider,
      connector.connectionExternalId,
      connector.displayName,
    );
    const sunday = ledger.createSnapshot(
      connectionId,
      "iteration-42",
      "2026-09-20T18:00:00Z",
    );
    ledger.createSnapshot(
      connectionId,
      "iteration-42",
      "2026-09-21T12:00:00Z",
    );
    const current = ledger.createSnapshot(
      connectionId,
      "iteration-42",
      "2026-09-23T15:00:00Z",
    );

    const window = ledger.getComparisonWindow("2026-09-21T00:00:00Z");

    expect(window.baseline.id).toBe(sunday.id);
    expect(window.current.id).toBe(current.id);
    expect(window.requestedSince).toBe("2026-09-21T00:00:00.000Z");
    expect(window.coverageComplete).toBe(true);
  });

  it("marks history incomplete when no snapshot predates the requested time", async () => {
    ledger = new SprintLedger();
    const connector = new FixtureConnector();
    await synchronize(ledger, connector);
    const connectionId = ledger.upsertConnection(
      connector.provider,
      connector.connectionExternalId,
      connector.displayName,
    );
    const earliest = ledger.createSnapshot(
      connectionId,
      "iteration-42",
      "2026-09-21T12:00:00Z",
    );
    ledger.createSnapshot(
      connectionId,
      "iteration-42",
      "2026-09-23T15:00:00Z",
    );

    const window = ledger.getComparisonWindow("2026-09-20T00:00:00Z");

    expect(window.baseline.id).toBe(earliest.id);
    expect(window.coverageComplete).toBe(false);
  });

  it("resolves evidence for blockers outside the sprint iteration", async () => {
    ledger = new SprintLedger();
    const connector = new FixtureConnector();
    await synchronize(ledger, connector);
    const connectionId = ledger.upsertConnection(
      connector.provider,
      connector.connectionExternalId,
      connector.displayName,
    );
    ledger.upsertWorkItem(connectionId, {
      ...batch.items[0],
      externalId: "external-blocker",
      iterationExternalId: null,
      key: "#120",
      title: "External dependency",
      url: "https://example.test/issues/120",
    });
    const snapshot = ledger.createSnapshot(
      connectionId,
      "iteration-42",
      "2026-09-18T16:30:00Z",
    );

    expect(ledger.getWorkItemEvidence(snapshot.id, "#120")).toEqual({
      itemKey: "#120",
      title: "External dependency",
      status: "in_review",
      url: "https://example.test/issues/120",
    });
  });
});
