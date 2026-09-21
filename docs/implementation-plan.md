# Implementation plan

## Milestone 1: prove the intelligence loop

- [x] Define normalized sprint and work-item types.
- [x] Create before/after sprint fixtures.
- [x] Compute status, scope, assignment, and comment changes.
- [x] Detect blockers, stale work, failed reviews, and unowned work.
- [x] Generate deterministic evidence-aware answers.
- [x] Build an interactive React dashboard.
- [x] Add unit coverage for core analysis behavior.
- [ ] Add accessible interaction tests and visual snapshots.

## Milestone 2: make the ledger real

- [ ] Add SQLite and migrations for sources, items, events, relationships, and snapshots.
- [ ] Define a connector contract and retain raw source payloads.
- [ ] Import GitHub issues and pull requests from a repository.
- [ ] Import comments, reviews, and issue dependencies.
- [ ] Import a Project V2 iteration and its field values.
- [ ] Make sync idempotent and add reconciliation tests.
- [ ] Replace fixture reads in the dashboard with an API.

## Milestone 3: add the agent safely

- [ ] Expose narrow read-only tools over the ledger.
- [ ] Add claim/evidence output schemas.
- [ ] Require citations for every material generated claim.
- [ ] Add model-provider configuration without coupling the domain layer to one vendor.
- [ ] Record prompts, tool calls, latency, token usage, and cost.
- [ ] Refuse answers when evidence is insufficient.

## Milestone 4: evaluate and polish

- [ ] Build labeled sprint-history fixtures with edge cases.
- [ ] Score change detection, citation validity, and risk classification.
- [ ] Add end-to-end Playwright coverage.
- [ ] Publish benchmark results and known failure modes.
- [ ] Add screenshots, architecture assets, and a 60–90 second demo.
- [ ] Provide one-command local setup.

## Next task

Implement the SQLite ledger and connector boundary, then ingest a public GitHub repository through a read-only token or unauthenticated public API.
