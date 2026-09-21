# Product research: sprint intelligence

Date: 2026-09-21

## Decision

Build a GitHub-first temporal sprint intelligence system. Its core is not a chatbot. Its core is an append-only activity ledger plus immutable snapshots that can answer “what changed between A and B?” with verifiable evidence.

The first product surface is a React dashboard for engineering leads. It combines a snapshot diff, dependency risks, stale-work detection, review bottlenecks, and an evidence-linked catch-up brief.

## What already exists

The obvious “AI summarizes project work” space is already crowded:

- Linear Agent can summarize cycle progress, flag rollover risk, analyze workspace data, and update work items. Its context includes issues, relationships, comments, and activity history. [Linear Agent documentation](https://linear.app/docs/linear-agent)
- Linear’s project updates already include health indicators, change history, progress reports, staleness reminders, Slack delivery, and agent-assisted drafting. [Linear project updates](https://linear.app/docs/initiative-and-project-updates)
- Linear Insights provides configurable analytics over issues, cycles, projects, and teams. [Linear Insights](https://linear.app/docs/insights)
- GitHub Projects supports iteration fields and project item metadata through GraphQL. [GitHub Projects API](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects)
- Jira exposes native sprint membership and sprint issue queries. [Jira sprint API](https://developer.atlassian.com/cloud/jira/software/rest/api-group-sprint)

A generic “ask questions about your sprint” interface is therefore not enough.

## Product wedge

The portfolio-worthy wedge is an evidence-grade temporal layer across engineering systems:

1. Reconstruct the state of a sprint at an arbitrary point in time.
2. Separate computed facts from model-written interpretation.
3. Trace blockers transitively and show the exact work items behind a risk.
4. Make every generated claim inspectable down to a source event.
5. Evaluate whether claims and citations remain correct after connector or prompt changes.
6. Eventually combine GitHub implementation activity with Jira planning activity in one ledger.

This is narrower than a general work-management agent and more defensible than a summary bot.

## Source-system findings

### GitHub

- Issues and pull requests share issue-level timeline events; pull requests add review-specific events. [Timeline API](https://docs.github.com/en/rest/issues/timeline)
- GitHub now exposes first-class blocked-by and blocking relationships through the issue dependencies API. [Issue dependencies API](https://docs.github.com/en/rest/issues/issue-dependencies)
- Project V2 iterations provide a workable sprint concept, but the GraphQL project model must be normalized separately from repository issue data. [Projects GraphQL reference](https://docs.github.com/en/graphql/reference/projects)
- Project item webhooks are still documented as public preview, so periodic reconciliation remains necessary even after webhook ingestion. [Webhook event reference](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
- GitHub recommends minimum permissions, webhook-first ingestion, conditional requests, and careful rate-limit handling. [GitHub App best practices](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app)
- Failed webhook deliveries are not automatically redelivered, and GitHub’s redelivery window is limited. The ledger therefore needs delivery IDs, idempotency, and a reconciliation job. [Webhook redelivery](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks)

### Jira

- Jira has a native sprint object and endpoints for sprint membership, unlike GitHub’s configurable iteration field. [Jira sprint API](https://developer.atlassian.com/cloud/jira/software/rest/api-group-sprint)
- Issue changelogs can be retrieved in bulk and ordered chronologically, which fits an append-only event normalization process. [Jira issue API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/)
- Connector code must not assume comments remain embedded in general issue webhook payloads; Atlassian directs integrations toward dedicated comment webhooks. [Atlassian webhook change notice](https://developer.atlassian.com/cloud/jira/platform/change-notice-removal-of-comments-from-issue-webhooks/)

## MVP definition

### Demonstrable workflow

1. Select a GitHub Project iteration.
2. Compare the current state with a Monday snapshot.
3. See status, scope, assignment, comment, review, and dependency changes.
4. Open risk cards for blockers, stale work, review failures, and unowned additions.
5. Ask for a change brief, blocker explanation, risk summary, or holiday catch-up.
6. Inspect evidence for each answer.

### First implementation slice

Use two deterministic fixture snapshots and implement the diff/risk engine plus dashboard. This gives us a testable product loop before credentials and network failure modes enter the system.

### Second implementation slice

Add a read-only GitHub connector and SQLite-backed ledger for local development. Import repository issues, pull requests, comments, reviews, dependencies, and one Project V2 iteration. Reconcile current state on demand.

### Third implementation slice

Add a GitHub App, webhook ingestion, PostgreSQL, background jobs, and model-generated narrative constrained to computed evidence.

## Explicitly deferred

- Jira connector
- Slack delivery
- Autonomous issue mutations
- Team-performance scoring
- Predictive delivery dates
- Multi-organization tenancy and billing

These do not belong in the first credible demo.
