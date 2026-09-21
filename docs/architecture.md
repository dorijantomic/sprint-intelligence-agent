# Architecture baseline

## Components

### Connector and sync service

Imports source objects and append-only activity. Checkpoints make repeated syncs idempotent, while raw provider payloads remain available for audit and parser upgrades. Each run records latency, provider request count, throughput, and failure details; unchanged state does not produce a duplicate sprint snapshot.

The core contract is provider-neutral. GitHub is the first live connector and Jira is a later connector; both normalize iterations, work items, relationships, and events into the same ledger without erasing their raw source payloads. The local product runs syncs directly and prevents concurrent work for the same connection; a durable queue is intentionally deferred until hosted scale requires it.

### Sprint ledger

Stores normalized work items, relationships, events, sprint membership, and immutable snapshots. Business-time calculations use a configurable team calendar.

### Deterministic analyzers

Computes facts that should not depend on model judgment: field changes, additions and removals, inactivity windows, dependency paths, review age, and missing ownership.

### Agent

Uses narrow read tools over the ledger. It turns computed facts into explanations, risk summaries, and catch-up briefs. Every material statement carries source references.

### API and React dashboard

Presents the sprint overview, snapshot diff, dependency graph, evidence drawer, risk list, and conversational queries.

During local development, the API reads immutable snapshots from SQLite and Vite proxies `/api` requests to it. The setup API uses the active `gh` login to discover projects and iterations, persists only non-secret connection metadata, and exposes a direct synchronization action. The dashboard retains a bundled fixture only as an explicit fallback when the API is unavailable.

### Evaluation harness

Replays fixed sprint histories and scores factual correctness, citation validity, risk classification, latency, token use, and estimated cost.

## Initial data model

- `source_connection`
- `work_item`
- `work_item_relationship`
- `activity_event`
- `sync_run`
- `sprint`
- `sprint_membership`
- `sprint_snapshot`
- `analysis_run`
- `claim`
- `claim_evidence`
- `approval_request`

## Trust boundary

Provider content is untrusted input. Connectors validate payloads, agent tools expose typed queries instead of arbitrary database access, secrets stay server-side, and all future write operations require an explicit approval record.

Local GitHub ingestion reuses the authenticated `gh` CLI credential. CI may inject a token through the environment, while a deployed multi-user version will use GitHub App installations rather than user CLI credentials.

## Implementation sequence

1. Prove the diff and risk engine with deterministic snapshots.
2. Add a source-neutral connector contract and local SQLite ledger.
3. Add read-only GitHub ingestion and reconciliation.
4. Put a narrow API between the ledger and dashboard.
5. Add evidence-constrained model narration and evaluations.
