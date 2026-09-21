# Architecture baseline

## Components

### Connector and sync service

Imports source objects and append-only activity. Checkpoints make repeated syncs idempotent, while raw provider payloads remain available for audit and parser upgrades. Each run records latency, provider request count, throughput, and failure details; unchanged state does not produce a duplicate sprint snapshot.

The core contract is provider-neutral. GitHub Projects and Jira Cloud both normalize iterations, work items, relationships, comments, and observed updates into the same ledger without erasing their raw source payloads. The local product runs syncs directly and prevents concurrent work for the same connection; a durable queue is intentionally deferred until hosted scale requires it.

### Sprint ledger

Stores normalized work items, relationships, events, sprint membership, and immutable snapshots. Business-time calculations use a configurable team calendar.

### Deterministic analyzers

Computes facts that should not depend on model judgment: field changes, additions and removals, inactivity windows, dependency paths, review age, and missing ownership.

### Agent

Uses five narrow read tools over the ledger: overview, changes, deterministic risks, work-item/blocker detail, and activity. A provider-neutral `AgentRuntime` receives generic JSON-schema tool definitions and returns one normalized tool call per turn. Built-in adapters cover OpenCode Go, Gemini, OpenAI Responses, and OpenAI-compatible Chat Completions; a custom runtime module can bridge any other hosted model, local model, CLI agent, or agent service without changing the evidence loop.

The application—not the supplied runtime—executes tools and keeps fact and evidence registries for that run. Each submitted claim must cite retrieved fact IDs; the server derives the source links and rejects unknown grounding. Unsupported submissions fall back to deterministic narration. Every run records its tool trace, provider, model, mode, latency, and token counts.

### API and React dashboard

Presents the sprint overview, snapshot diff, dependency graph, evidence drawer, risk list, and conversational queries.

During local development, the API reads immutable snapshots from SQLite and Vite proxies `/api` requests to it. The setup API uses the active `gh` login to discover GitHub projects and iterations or accepts a Jira Cloud sprint; it persists only non-secret connection metadata and exposes a direct synchronization action. Jira, Atlassian OAuth app, and agent credentials use ignored, owner-readable local files, are redacted from every response, and never enter SQLite or browser storage. Atlassian app credentials and agent settings apply without restart. Agent setup verifies typed tool calling before the runtime answers sprint questions. Environment configuration remains an optional deployment override. The dashboard retains a bundled fixture only as an explicit fallback when the API is unavailable.

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

Provider content and supplied-agent output are untrusted input. Connectors validate payloads, agent tools expose typed queries instead of arbitrary database access, secrets stay server-side, and all future write operations require an explicit approval record. The browser may submit a credential but cannot read it back. Local credentials live in a mode-`0600`, Git-ignored file; hosted deployments must use a managed secret store. Agent runtimes can request read tools but receive no ledger handle and cannot forge evidence accepted by the server. A custom runtime module is locally trusted executable code and should only be configured from a path controlled by the operator.

Local GitHub ingestion reuses the authenticated `gh` CLI credential. Jira uses email plus an API token stored in the local source-secret store. CI may inject credentials through the environment, while a deployed multi-user version should use GitHub App installations, OAuth-based Jira access, and a managed secret service.

## Implementation sequence

1. Prove the diff and risk engine with deterministic snapshots.
2. Add a source-neutral connector contract and local SQLite ledger.
3. Add read-only GitHub ingestion and reconciliation.
4. Put a narrow API between the ledger and dashboard.
5. Add evidence-constrained model narration and evaluations.
6. Add real temporal windows, persisted agent audit traces, and live-model evaluations.
7. Prove the provider-neutral boundary with a Jira Cloud connector.
