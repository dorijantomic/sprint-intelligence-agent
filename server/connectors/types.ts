export type ProviderKind = "github" | "jira" | "fixture";

export interface NormalizedIteration {
  externalId: string;
  name: string;
  goal: string | null;
  startsAt: string | null;
  endsAt: string | null;
  raw: unknown;
}

export interface NormalizedWorkItem {
  externalId: string;
  iterationExternalId: string | null;
  key: string;
  title: string;
  kind: "issue" | "pull_request" | "task";
  status: string;
  priority: string | null;
  assignee: string | null;
  estimate: number | null;
  commentCount: number;
  reviewState: "none" | "pending" | "approved" | "changes_requested";
  updatedAt: string;
  url: string;
  raw: unknown;
}

export type RelationshipKind = "blocked_by" | "blocks" | "parent";

export interface NormalizedRelationshipMutation {
  action: "upsert" | "remove";
  fromExternalId: string;
  toExternalId: string;
  kind: RelationshipKind;
  observedAt: string;
}

export interface NormalizedEvent {
  externalId: string;
  workItemExternalId: string | null;
  kind: string;
  occurredAt: string;
  actor: string | null;
  url: string | null;
  payload: unknown;
}

export interface ConnectorBatch {
  iteration: NormalizedIteration | null;
  items: NormalizedWorkItem[];
  relationships: NormalizedRelationshipMutation[];
  events: NormalizedEvent[];
  cursor: string | null;
}

export interface SourceConnector {
  readonly provider: ProviderKind;
  readonly connectionExternalId: string;
  readonly displayName: string;
  pull(cursor: string | null): AsyncIterable<ConnectorBatch>;
}
