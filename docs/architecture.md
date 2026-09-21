# Architecture baseline

## Components

### Connector and sync worker

Imports source objects and append-only activity. Checkpoints make repeated syncs idempotent, while raw provider payloads remain available for audit and parser upgrades.

### Sprint ledger

Stores normalized work items, relationships, events, sprint membership, and immutable snapshots. Business-time calculations use a configurable team calendar.

### Deterministic analyzers

Computes facts that should not depend on model judgment: field changes, additions and removals, inactivity windows, dependency paths, review age, and missing ownership.

### Agent

Uses narrow read tools over the ledger. It turns computed facts into explanations, risk summaries, and catch-up briefs. Every material statement carries source references.

### API and React dashboard

Presents the sprint overview, snapshot diff, dependency graph, evidence drawer, risk list, and conversational queries.

### Evaluation harness

Replays fixed sprint histories and scores factual correctness, citation validity, risk classification, latency, token use, and estimated cost.

## Initial data model

- `source_connection`
- `work_item`
- `work_item_relationship`
- `activity_event`
- `sprint`
- `sprint_membership`
- `sprint_snapshot`
- `analysis_run`
- `claim`
- `claim_evidence`
- `approval_request`

## Trust boundary

Provider content is untrusted input. Connectors validate payloads, agent tools expose typed queries instead of arbitrary database access, secrets stay server-side, and all future write operations require an explicit approval record.

## First implementation slice

Build a local fixture connector before GitHub OAuth. A deterministic fixture makes the ledger, diff engine, UI, and eval path testable without network access; the live connector can then target the same interface.
