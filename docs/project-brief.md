# Project brief

## User

An engineering manager, tech lead, or developer who needs to understand sprint movement without reconstructing it manually from issue and pull-request feeds.

## Core jobs

- Compare the current sprint state with any earlier point in time.
- Explain scope, status, ownership, dependency, discussion, and review changes.
- Surface work that is blocked, stale, newly risky, or missing an owner.
- Produce a prioritized catch-up brief after time away.
- Preserve evidence so users can verify every conclusion.

## MVP boundaries

The first release uses GitHub as the real connector and models Jira-like concepts internally. It is read-only: the agent may inspect and summarize data but may not change issues, pull requests, labels, or milestones. A later release can add write actions behind explicit approval.

## Representative questions

- What changed in this sprint since Monday at 09:00?
- Which pull requests are holding up other work?
- Which in-progress tickets have had no meaningful activity for three working days?
- What decisions were made in comments while I was away?
- What threatens the sprint goal, and what evidence supports that assessment?

## Success measures

- Change detection precision and recall on a versioned fixture set.
- Citation correctness: the cited event supports the generated claim.
- Risk-ranking agreement with labeled examples.
- End-to-end sync and answer latency.
- Token and model cost per generated brief.

## Explicit non-goals for the MVP

- Replacing the issue tracker.
- Autonomous ticket or pull-request mutation.
- Supporting every project-management provider.
- Producing unsupported team-performance judgments.
