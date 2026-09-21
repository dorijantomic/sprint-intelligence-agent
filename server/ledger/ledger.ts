import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  NormalizedEvent,
  NormalizedIteration,
  NormalizedRelationshipMutation,
  NormalizedWorkItem,
  ProviderKind,
} from "../connectors/types.js";
import { schema } from "./schema.js";

interface IdRow {
  id: number;
}

interface CursorRow {
  cursor: string | null;
}

interface SnapshotRow {
  id: string;
  captured_at: string;
  iteration_name: string;
  source_display_name: string;
  item_count: number;
  config_json: string | null;
}

interface SnapshotItemRow {
  state_json: string;
}

interface RelationshipRow {
  from_id: number;
  target_key: string;
}

interface WorkItemRow extends Record<string, unknown> {
  id: number;
}

interface WorkItemEvidenceRow {
  item_key: string;
  title: string;
  status: string;
  url: string;
}

interface ActivityEventRow {
  external_id: string;
  item_key: string;
  item_title: string;
  kind: string;
  occurred_at: string;
  actor: string | null;
  url: string | null;
  payload_json: string;
}

interface SyncRunRow {
  id: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  status: "succeeded" | "failed";
  request_count: number;
  batch_count: number;
  item_count: number;
  events_added: number;
  relationship_count: number;
  error_message: string | null;
}

interface ConnectionConfigRow {
  id: number;
  provider: ProviderKind;
  external_id: string;
  display_name: string;
  config_json: string;
  updated_at: string;
}

export interface StoredSnapshot {
  id: string;
  capturedAt: string;
  iterationName: string;
  sourceName: string;
  sourceUrl: string | null;
  items: Array<Record<string, unknown>>;
}

export interface AgentRunInput {
  snapshotId: string | null;
  question: string;
  answer: unknown;
  mode: "model" | "deterministic";
  model: string | null;
  toolCalls: string[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface StoredActivityEvent {
  id: string;
  itemId: string;
  itemTitle: string;
  kind: string;
  occurredAt: string;
  actor: string | null;
  url: string | null;
  payload: Record<string, unknown>;
}

export interface StoredWorkItemEvidence {
  itemKey: string;
  title: string;
  status: string;
  url: string;
}

export interface SyncRunInput {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: "succeeded" | "failed";
  requestCount: number;
  batches: number;
  items: number;
  eventsAdded: number;
  relationships: number;
  errorMessage: string | null;
}

export interface StoredSyncRun extends SyncRunInput {
  id: string;
}

export interface SnapshotCreationResult {
  snapshot: StoredSnapshot;
  created: boolean;
}

export interface StoredConnectionConfig<T = Record<string, unknown>> {
  id: number;
  provider: ProviderKind;
  externalId: string;
  displayName: string;
  config: T;
  updatedAt: string;
}

export class SprintLedger {
  readonly database: DatabaseSync;

  constructor(path = ":memory:") {
    this.database = new DatabaseSync(path);
    this.database.exec(schema);
  }

  close(): void {
    this.database.close();
  }

  transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  upsertConnection(
    provider: ProviderKind,
    externalId: string,
    displayName: string,
  ): number {
    const now = new Date().toISOString();
    const row = this.database
      .prepare(`
        INSERT INTO source_connections (
          provider, external_id, display_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(provider, external_id) DO UPDATE SET
          display_name = excluded.display_name,
          updated_at = excluded.updated_at
        RETURNING id
      `)
      .get(provider, externalId, displayName, now, now) as unknown as IdRow;

    return row.id;
  }

  saveConnectionConfig<T extends Record<string, unknown>>(
    provider: ProviderKind,
    externalId: string,
    displayName: string,
    config: T,
  ): StoredConnectionConfig<T> {
    const connectionId = this.upsertConnection(provider, externalId, displayName);
    const updatedAt = new Date().toISOString();
    this.database
      .prepare(`
        INSERT INTO connection_configs (
          source_connection_id, config_json, updated_at
        ) VALUES (?, ?, ?)
        ON CONFLICT(source_connection_id) DO UPDATE SET
          config_json = excluded.config_json,
          updated_at = excluded.updated_at
      `)
      .run(connectionId, JSON.stringify(config), updatedAt);

    return {
      id: connectionId,
      provider,
      externalId,
      displayName,
      config,
      updatedAt,
    };
  }

  getConnectionConfigs<T = Record<string, unknown>>(
    provider?: ProviderKind,
  ): Array<StoredConnectionConfig<T>> {
    const rows = (provider
      ? this.database
          .prepare(`
            SELECT c.id, c.provider, c.external_id, c.display_name,
                   cfg.config_json, cfg.updated_at
            FROM source_connections c
            JOIN connection_configs cfg ON cfg.source_connection_id = c.id
            WHERE c.provider = ?
            ORDER BY cfg.updated_at DESC
          `)
          .all(provider)
      : this.database
          .prepare(`
            SELECT c.id, c.provider, c.external_id, c.display_name,
                   cfg.config_json, cfg.updated_at
            FROM source_connections c
            JOIN connection_configs cfg ON cfg.source_connection_id = c.id
            ORDER BY cfg.updated_at DESC
          `)
          .all()) as unknown as ConnectionConfigRow[];

    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      externalId: row.external_id,
      displayName: row.display_name,
      config: JSON.parse(row.config_json) as T,
      updatedAt: row.updated_at,
    }));
  }

  getConnectionConfig<T = Record<string, unknown>>(
    connectionId: number,
  ): StoredConnectionConfig<T> | null {
    const row = this.database
      .prepare(`
        SELECT c.id, c.provider, c.external_id, c.display_name,
               cfg.config_json, cfg.updated_at
        FROM source_connections c
        JOIN connection_configs cfg ON cfg.source_connection_id = c.id
        WHERE c.id = ?
      `)
      .get(connectionId) as unknown as ConnectionConfigRow | undefined;
    if (!row) return null;

    return {
      id: row.id,
      provider: row.provider,
      externalId: row.external_id,
      displayName: row.display_name,
      config: JSON.parse(row.config_json) as T,
      updatedAt: row.updated_at,
    };
  }

  upsertIteration(connectionId: number, iteration: NormalizedIteration): number {
    const row = this.database
      .prepare(`
        INSERT INTO iterations (
          source_connection_id, external_id, name, goal,
          starts_at, ends_at, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_connection_id, external_id) DO UPDATE SET
          name = excluded.name,
          goal = excluded.goal,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          raw_json = excluded.raw_json
        RETURNING id
      `)
      .get(
        connectionId,
        iteration.externalId,
        iteration.name,
        iteration.goal,
        iteration.startsAt,
        iteration.endsAt,
        JSON.stringify(iteration.raw ?? null),
      ) as unknown as IdRow;

    return row.id;
  }

  upsertWorkItem(connectionId: number, item: NormalizedWorkItem): number {
    const iterationId = item.iterationExternalId
      ? this.findIterationId(connectionId, item.iterationExternalId)
      : null;
    const row = this.database
      .prepare(`
        INSERT INTO work_items (
          source_connection_id, iteration_id, external_id, item_key,
          title, kind, status, priority, assignee, estimate,
          comment_count, review_state, source_updated_at, url, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_connection_id, external_id) DO UPDATE SET
          iteration_id = excluded.iteration_id,
          item_key = excluded.item_key,
          title = excluded.title,
          kind = excluded.kind,
          status = excluded.status,
          priority = excluded.priority,
          assignee = excluded.assignee,
          estimate = excluded.estimate,
          comment_count = excluded.comment_count,
          review_state = excluded.review_state,
          source_updated_at = excluded.source_updated_at,
          url = excluded.url,
          raw_json = excluded.raw_json
        RETURNING id
      `)
      .get(
        connectionId,
        iterationId,
        item.externalId,
        item.key,
        item.title,
        item.kind,
        item.status,
        item.priority,
        item.assignee,
        item.estimate,
        item.commentCount,
        item.reviewState,
        item.updatedAt,
        item.url,
        JSON.stringify(item.raw ?? null),
      ) as unknown as IdRow;

    return row.id;
  }

  applyRelationship(
    connectionId: number,
    relationship: NormalizedRelationshipMutation,
  ): void {
    const fromId = this.findWorkItemId(connectionId, relationship.fromExternalId);
    const toId = this.findWorkItemId(connectionId, relationship.toExternalId);

    if (relationship.action === "remove") {
      this.database
        .prepare(`
          DELETE FROM work_item_relationships
          WHERE source_connection_id = ?
            AND from_work_item_id = ?
            AND to_work_item_id = ?
            AND kind = ?
        `)
        .run(connectionId, fromId, toId, relationship.kind);
      return;
    }

    this.database
      .prepare(`
        INSERT INTO work_item_relationships (
          source_connection_id, from_work_item_id, to_work_item_id,
          kind, observed_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(source_connection_id, from_work_item_id, to_work_item_id, kind)
        DO UPDATE SET observed_at = excluded.observed_at
      `)
      .run(connectionId, fromId, toId, relationship.kind, relationship.observedAt);
  }

  clearRelationshipsFrom(
    connectionId: number,
    fromExternalId: string,
    kind: NormalizedRelationshipMutation["kind"],
  ): void {
    const fromId = this.findWorkItemId(connectionId, fromExternalId);
    this.database
      .prepare(`
        DELETE FROM work_item_relationships
        WHERE source_connection_id = ?
          AND from_work_item_id = ?
          AND kind = ?
      `)
      .run(connectionId, fromId, kind);
  }

  appendEvent(connectionId: number, event: NormalizedEvent): boolean {
    const workItemId = event.workItemExternalId
      ? this.findWorkItemId(connectionId, event.workItemExternalId)
      : null;
    const result = this.database
      .prepare(`
        INSERT OR IGNORE INTO activity_events (
          source_connection_id, work_item_id, external_id, kind,
          occurred_at, actor, url, payload_json, ingested_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        connectionId,
        workItemId,
        event.externalId,
        event.kind,
        event.occurredAt,
        event.actor,
        event.url,
        JSON.stringify(event.payload ?? null),
        new Date().toISOString(),
      );

    return result.changes === 1;
  }

  getCheckpoint(connectionId: number): string | null {
    const row = this.database
      .prepare("SELECT cursor FROM sync_checkpoints WHERE source_connection_id = ?")
      .get(connectionId) as unknown as CursorRow | undefined;
    return row?.cursor ?? null;
  }

  saveCheckpoint(connectionId: number, cursor: string | null): void {
    this.database
      .prepare(`
        INSERT INTO sync_checkpoints (source_connection_id, cursor, synced_at)
        VALUES (?, ?, ?)
        ON CONFLICT(source_connection_id) DO UPDATE SET
          cursor = excluded.cursor,
          synced_at = excluded.synced_at
      `)
      .run(connectionId, cursor, new Date().toISOString());
  }

  recordSyncRun(connectionId: number, run: SyncRunInput): StoredSyncRun {
    const id = randomUUID();
    this.database
      .prepare(`
        INSERT INTO sync_runs (
          id, source_connection_id, started_at, completed_at, duration_ms,
          status, request_count, batch_count, item_count, events_added,
          relationship_count, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        connectionId,
        run.startedAt,
        run.completedAt,
        run.durationMs,
        run.status,
        run.requestCount,
        run.batches,
        run.items,
        run.eventsAdded,
        run.relationships,
        run.errorMessage,
      );
    return { id, ...run };
  }

  recordAgentRun(run: AgentRunInput): string {
    const id = randomUUID();
    this.database
      .prepare(`
        INSERT INTO agent_runs (
          id, snapshot_id, question, answer_json, mode, model,
          tool_calls_json, started_at, completed_at, duration_ms,
          model_calls, input_tokens, output_tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        run.snapshotId,
        run.question,
        JSON.stringify(run.answer),
        run.mode,
        run.model,
        JSON.stringify(run.toolCalls),
        run.startedAt,
        run.completedAt,
        run.durationMs,
        run.modelCalls,
        run.inputTokens,
        run.outputTokens,
      );
    return id;
  }

  createSnapshot(
    connectionId: number,
    iterationExternalId: string,
    capturedAt = new Date().toISOString(),
  ): StoredSnapshot {
    const iterationId = this.findIterationId(connectionId, iterationExternalId);
    const snapshotId = randomUUID();
    const itemRows = this.database
      .prepare(`
        SELECT id, external_id, item_key, title, kind, status, priority,
               assignee, estimate, comment_count, review_state,
               source_updated_at, url
        FROM work_items
        WHERE iteration_id = ?
        ORDER BY item_key
      `)
      .all(iterationId) as unknown as WorkItemRow[];
    const relationshipRows = this.database
      .prepare(`
        SELECT r.from_work_item_id AS from_id, target.item_key AS target_key
        FROM work_item_relationships r
        JOIN work_items source ON source.id = r.from_work_item_id
        JOIN work_items target ON target.id = r.to_work_item_id
        WHERE source.iteration_id = ? AND r.kind = 'blocked_by'
        ORDER BY target.item_key
      `)
      .all(iterationId) as unknown as RelationshipRow[];
    const blockersByItem = new Map<number, string[]>();
    for (const relationship of relationshipRows) {
      const blockers = blockersByItem.get(relationship.from_id) ?? [];
      blockers.push(relationship.target_key);
      blockersByItem.set(relationship.from_id, blockers);
    }
    const items = itemRows.map((item) => ({
      ...item,
      blocked_by: blockersByItem.get(item.id) ?? [],
    }));

    this.transaction(() => {
      this.database
        .prepare(`
          INSERT INTO sprint_snapshots (id, iteration_id, captured_at, item_count)
          VALUES (?, ?, ?, ?)
        `)
        .run(snapshotId, iterationId, capturedAt, items.length);

      const insertItem = this.database.prepare(`
        INSERT INTO sprint_snapshot_items (snapshot_id, work_item_id, state_json)
        VALUES (?, ?, ?)
      `);
      for (const item of items) {
        insertItem.run(snapshotId, item.id, JSON.stringify(item));
      }
    });

    return this.getSnapshot(snapshotId);
  }

  createSnapshotIfChanged(
    connectionId: number,
    iterationExternalId: string,
    capturedAt = new Date().toISOString(),
  ): SnapshotCreationResult {
    const iterationId = this.findIterationId(connectionId, iterationExternalId);
    const previousRow = this.database
      .prepare(`
        SELECT id
        FROM sprint_snapshots
        WHERE iteration_id = ?
        ORDER BY captured_at DESC
        LIMIT 1
      `)
      .get(iterationId) as unknown as { id: string } | undefined;
    const previous = previousRow ? this.getSnapshot(previousRow.id) : null;
    const snapshot = this.createSnapshot(
      connectionId,
      iterationExternalId,
      capturedAt,
    );

    if (previous && JSON.stringify(previous.items) === JSON.stringify(snapshot.items)) {
      this.database
        .prepare("DELETE FROM sprint_snapshots WHERE id = ?")
        .run(snapshot.id);
      return { snapshot: previous, created: false };
    }

    return { snapshot, created: true };
  }

  getSnapshot(snapshotId: string): StoredSnapshot {
    const snapshot = this.database
      .prepare(`
        SELECT s.id, s.captured_at, s.item_count, i.name AS iteration_name,
               c.display_name AS source_display_name, cfg.config_json
        FROM sprint_snapshots s
        JOIN iterations i ON i.id = s.iteration_id
        JOIN source_connections c ON c.id = i.source_connection_id
        LEFT JOIN connection_configs cfg ON cfg.source_connection_id = c.id
        WHERE s.id = ?
      `)
      .get(snapshotId) as unknown as SnapshotRow | undefined;

    if (!snapshot) throw new Error(`Unknown snapshot: ${snapshotId}`);

    const itemRows = this.database
      .prepare(`
        SELECT state_json
        FROM sprint_snapshot_items
        WHERE snapshot_id = ?
        ORDER BY work_item_id
      `)
      .all(snapshotId) as unknown as SnapshotItemRow[];

    const connectionConfig = snapshot.config_json
      ? (JSON.parse(snapshot.config_json) as Record<string, unknown>)
      : null;
    return {
      id: snapshot.id,
      capturedAt: snapshot.captured_at,
      iterationName: snapshot.iteration_name,
      sourceName: snapshot.source_display_name,
      sourceUrl:
        typeof connectionConfig?.projectUrl === "string"
          ? connectionConfig.projectUrl
          : null,
      items: itemRows.map((row) => JSON.parse(row.state_json) as Record<string, unknown>),
    };
  }

  getRecentSnapshots(limit = 2): StoredSnapshot[] {
    const rows = this.database
      .prepare(`
        SELECT id
        FROM sprint_snapshots
        WHERE iteration_id = (
          SELECT iteration_id
          FROM sprint_snapshots
          ORDER BY captured_at DESC
          LIMIT 1
        )
        ORDER BY captured_at DESC
        LIMIT ?
      `)
      .all(limit) as unknown as Array<{ id: string }>;
    return rows.map((row) => this.getSnapshot(row.id));
  }

  getEventsBetweenSnapshots(
    baselineSnapshotId: string,
    currentSnapshotId: string,
  ): StoredActivityEvent[] {
    const rows = this.database
      .prepare(`
        SELECT e.external_id, w.item_key, w.title AS item_title, e.kind,
               e.occurred_at, e.actor, e.url, e.payload_json
        FROM sprint_snapshots baseline
        JOIN sprint_snapshots current
          ON current.id = ?
         AND current.iteration_id = baseline.iteration_id
        JOIN work_items w ON w.iteration_id = current.iteration_id
        JOIN activity_events e ON e.work_item_id = w.id
        WHERE baseline.id = ?
          AND e.occurred_at > baseline.captured_at
          AND e.occurred_at <= current.captured_at
        ORDER BY e.occurred_at DESC, e.id DESC
      `)
      .all(currentSnapshotId, baselineSnapshotId) as unknown as ActivityEventRow[];

    return rows.map((row) => ({
      id: row.external_id,
      itemId: row.item_key,
      itemTitle: row.item_title,
      kind: row.kind,
      occurredAt: row.occurred_at,
      actor: row.actor,
      url: row.url,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    }));
  }

  getWorkItemEvidence(
    snapshotId: string,
    itemKey: string,
  ): StoredWorkItemEvidence | null {
    const row = this.database
      .prepare(`
        SELECT w.item_key, w.title, w.status, w.url
        FROM sprint_snapshots s
        JOIN iterations i ON i.id = s.iteration_id
        JOIN work_items w ON w.source_connection_id = i.source_connection_id
        WHERE s.id = ? AND w.item_key = ?
        ORDER BY CASE WHEN w.iteration_id = i.id THEN 0 ELSE 1 END
        LIMIT 1
      `)
      .get(snapshotId, itemKey) as unknown as WorkItemEvidenceRow | undefined;
    if (!row) return null;
    return {
      itemKey: row.item_key,
      title: row.title,
      status: row.status,
      url: row.url,
    };
  }

  getLatestSyncRunForSnapshot(snapshotId: string): StoredSyncRun | null {
    const row = this.database
      .prepare(`
        SELECT r.id, r.started_at, r.completed_at, r.duration_ms, r.status,
               r.request_count, r.batch_count, r.item_count, r.events_added,
               r.relationship_count, r.error_message
        FROM sprint_snapshots s
        JOIN iterations i ON i.id = s.iteration_id
        JOIN sync_runs r ON r.source_connection_id = i.source_connection_id
        WHERE s.id = ?
        ORDER BY r.completed_at DESC
        LIMIT 1
      `)
      .get(snapshotId) as unknown as SyncRunRow | undefined;
    if (!row) return null;

    return {
      id: row.id,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      durationMs: row.duration_ms,
      status: row.status,
      requestCount: row.request_count,
      batches: row.batch_count,
      items: row.item_count,
      eventsAdded: row.events_added,
      relationships: row.relationship_count,
      errorMessage: row.error_message,
    };
  }

  count(
    table:
      | "source_connections"
      | "iterations"
      | "work_items"
      | "work_item_relationships"
      | "activity_events"
      | "sync_runs"
      | "agent_runs"
      | "sprint_snapshots",
  ): number {
    const row = this.database
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .get() as unknown as { count: number };
    return row.count;
  }

  private findIterationId(connectionId: number, externalId: string): number {
    const row = this.database
      .prepare(`
        SELECT id FROM iterations
        WHERE source_connection_id = ? AND external_id = ?
      `)
      .get(connectionId, externalId) as unknown as IdRow | undefined;
    if (!row) throw new Error(`Unknown iteration: ${externalId}`);
    return row.id;
  }

  private findWorkItemId(connectionId: number, externalId: string): number {
    const row = this.database
      .prepare(`
        SELECT id FROM work_items
        WHERE source_connection_id = ? AND external_id = ?
      `)
      .get(connectionId, externalId) as unknown as IdRow | undefined;
    if (!row) throw new Error(`Unknown work item: ${externalId}`);
    return row.id;
  }
}
