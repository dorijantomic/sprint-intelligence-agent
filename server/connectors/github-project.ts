import type {
  ConnectorBatch,
  NormalizedIteration,
  NormalizedWorkItem,
  SourceConnector,
} from "./types.js";

const PROJECT_QUERY = `
  query SprintIntelligenceProject($owner: String!, $number: Int!, $after: String) {
    repositoryOwner(login: $owner) {
      ... on Organization {
        projectV2(number: $number) { ...ProjectData }
      }
      ... on User {
        projectV2(number: $number) { ...ProjectData }
      }
    }
  }

  fragment ProjectData on ProjectV2 {
    id
    title
    shortDescription
    items(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        isArchived
        fieldValues(first: 30) {
          nodes {
            ... on ProjectV2ItemFieldIterationValue {
              iterationId
              title
              startDate
              duration
              field { ... on ProjectV2FieldCommon { name } }
            }
            ... on ProjectV2ItemFieldSingleSelectValue {
              name
              field { ... on ProjectV2FieldCommon { name } }
            }
            ... on ProjectV2ItemFieldNumberValue {
              number
              field { ... on ProjectV2FieldCommon { name } }
            }
          }
        }
        content {
          ... on Issue {
            id
            number
            title
            url
            updatedAt
            state
            assignees(first: 10) { nodes { login } }
            comments(last: 50) {
              totalCount
              nodes { id bodyText createdAt updatedAt url author { login } }
            }
            blockedBy(first: 100) {
              nodes {
                id
                number
                title
                url
                updatedAt
                state
                assignees(first: 10) { nodes { login } }
                comments { totalCount }
                repository { nameWithOwner }
              }
            }
            repository { nameWithOwner }
          }
          ... on PullRequest {
            id
            number
            title
            url
            updatedAt
            state
            reviewDecision
            assignees(first: 10) { nodes { login } }
            comments(last: 50) {
              totalCount
              nodes { id bodyText createdAt updatedAt url author { login } }
            }
            reviews(last: 50) {
              nodes { id bodyText submittedAt updatedAt url state author { login } }
            }
            repository { nameWithOwner }
          }
        }
      }
    }
  }
`;

export interface GitHubProjectConnectorOptions {
  owner: string;
  projectNumber: number;
  iterationId: string;
  projectTitle?: string;
  token: string;
  fetch?: typeof fetch;
}

interface FieldValue {
  iterationId?: string;
  title?: string;
  startDate?: string;
  duration?: number;
  name?: string | null;
  number?: number | null;
  field?: { name: string } | null;
}

interface ProjectItem {
  id: string;
  isArchived: boolean;
  fieldValues: { nodes: Array<FieldValue | null> };
  content: GitHubContent | null;
}

interface GitHubComment {
  id: string;
  bodyText: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  author: { login: string } | null;
}

interface GitHubReview {
  id: string;
  bodyText: string;
  submittedAt: string | null;
  updatedAt: string;
  url: string;
  state: string;
  author: { login: string } | null;
}

interface GitHubIssueReference {
    id: string;
    number: number;
    title: string;
    url: string;
    updatedAt: string;
    state: string;
    assignees: { nodes: Array<{ login: string }> };
    comments: { totalCount: number };
    repository: { nameWithOwner: string };
}

interface GitHubContent extends GitHubIssueReference {
  reviewDecision?: string | null;
  comments: {
    totalCount: number;
    nodes?: Array<GitHubComment | null>;
  };
  blockedBy?: { nodes: Array<GitHubIssueReference | null> };
  reviews?: { nodes: Array<GitHubReview | null> };
}

interface ProjectData {
  id: string;
  title: string;
  shortDescription: string | null;
  items: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<ProjectItem | null>;
  };
}

interface QueryData {
  repositoryOwner: { projectV2: ProjectData | null } | null;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function fieldByName(item: ProjectItem, name: string): FieldValue | undefined {
  return item.fieldValues.nodes.find(
    (value): value is FieldValue =>
      value !== null && value.field?.name.toLowerCase() === name.toLowerCase(),
  );
}

function findIteration(
  item: ProjectItem,
  iterationId: string,
): FieldValue | undefined {
  return item.fieldValues.nodes.find(
    (value): value is FieldValue => value?.iterationId === iterationId,
  );
}

function normalizeStatus(item: ProjectItem): string {
  const configured = fieldByName(item, "Status")?.name;
  if (configured) return configured.toLowerCase().replaceAll(/\s+/g, "_");
  return item.content?.state.toLowerCase() ?? "unknown";
}

function normalizeEstimate(item: ProjectItem): number | null {
  for (const name of ["Estimate", "Story points", "Points"]) {
    const value = fieldByName(item, name)?.number;
    if (typeof value === "number") return value;
  }
  return null;
}

function normalizeItem(
  item: ProjectItem,
  iterationId: string,
): NormalizedWorkItem | null {
  if (!item.content || item.isArchived || !findIteration(item, iterationId)) return null;

  const priority = fieldByName(item, "Priority")?.name ?? null;
  const reviewState =
    item.content.reviewDecision === undefined
      ? "none"
      : item.content.reviewDecision === "APPROVED"
        ? "approved"
        : item.content.reviewDecision === "CHANGES_REQUESTED"
          ? "changes_requested"
          : "pending";
  return {
    externalId: item.content.id,
    iterationExternalId: iterationId,
    key: `${item.content.repository.nameWithOwner}#${item.content.number}`,
    title: item.content.title,
    kind: item.content.reviewDecision === undefined ? "issue" : "pull_request",
    status: normalizeStatus(item),
    priority: priority?.toLowerCase() ?? null,
    assignee: item.content.assignees.nodes[0]?.login ?? null,
    estimate: normalizeEstimate(item),
    commentCount: item.content.comments.totalCount,
    reviewState,
    updatedAt: item.content.updatedAt,
    url: item.content.url,
    raw: item,
  };
}

function normalizeDependency(item: GitHubIssueReference): NormalizedWorkItem {
  return {
    externalId: item.id,
    iterationExternalId: null,
    key: `${item.repository.nameWithOwner}#${item.number}`,
    title: item.title,
    kind: "issue",
    status: item.state.toLowerCase(),
    priority: null,
    assignee: item.assignees.nodes[0]?.login ?? null,
    estimate: null,
    commentCount: item.comments.totalCount,
    reviewState: "none",
    updatedAt: item.updatedAt,
    url: item.url,
    raw: item,
  };
}

function contentEvents(item: ProjectItem): ConnectorBatch["events"] {
  if (!item.content) return [];

  const comments = (item.content.comments.nodes ?? [])
    .filter((comment): comment is GitHubComment => comment !== null)
    .map((comment) => ({
      externalId: comment.id,
      workItemExternalId: item.content?.id ?? null,
      kind: "commented",
      occurredAt: comment.createdAt,
      actor: comment.author?.login ?? null,
      url: comment.url,
      payload: {
        body: comment.bodyText,
        updatedAt: comment.updatedAt,
        source: "github",
      },
    }));
  const reviews = (item.content.reviews?.nodes ?? [])
    .filter((review): review is GitHubReview => review !== null)
    .map((review) => ({
      externalId: review.id,
      workItemExternalId: item.content?.id ?? null,
      kind: "reviewed",
      occurredAt: review.submittedAt ?? review.updatedAt,
      actor: review.author?.login ?? null,
      url: review.url,
      payload: {
        body: review.bodyText,
        state: review.state.toLowerCase(),
        source: "github",
      },
    }));

  return [...comments, ...reviews];
}

export class GitHubProjectConnector implements SourceConnector {
  readonly provider = "github";
  readonly connectionExternalId: string;
  readonly displayName: string;
  requestCount = 0;
  private readonly request: typeof fetch;

  constructor(private readonly options: GitHubProjectConnectorOptions) {
    this.connectionExternalId = `${options.owner}/projects/${options.projectNumber}`;
    this.displayName = `${options.owner} · ${options.projectTitle ?? `Project ${options.projectNumber}`}`;
    this.request = options.fetch ?? fetch;
  }

  async *pull(_cursor: string | null): AsyncIterable<ConnectorBatch> {
    let after: string | null = null;
    let foundIteration = false;
    const sprintItemIds = new Set<string>();

    do {
      const project = await this.fetchProject(after);
      const matchingItems = project.items.nodes
        .filter((item): item is ProjectItem => item !== null)
        .filter((item) => findIteration(item, this.options.iterationId));
      const iteration = this.normalizeIteration(project, matchingItems);
      if (iteration) foundIteration = true;
      const items = matchingItems
        .map((item) => normalizeItem(item, this.options.iterationId))
        .filter((item): item is NormalizedWorkItem => item !== null);
      for (const item of items) sprintItemIds.add(item.externalId);
      const dependencyById = new Map<string, GitHubIssueReference>();
      for (const dependency of matchingItems.flatMap(
        (item) => item.content?.blockedBy?.nodes ?? [],
      )) {
        if (dependency && !sprintItemIds.has(dependency.id)) {
          dependencyById.set(dependency.id, dependency);
        }
      }
      const dependencies = [...dependencyById.values()].map(normalizeDependency);
      const relationships = matchingItems.flatMap((item) =>
        (item.content?.blockedBy?.nodes ?? [])
          .filter((dependency): dependency is GitHubIssueReference => dependency !== null)
          .map((dependency) => ({
            action: "upsert" as const,
            fromExternalId: item.content!.id,
            toExternalId: dependency.id,
            kind: "blocked_by" as const,
            observedAt: item.content!.updatedAt,
          })),
      );
      const evidenceEvents = matchingItems.flatMap(contentEvents);

      yield {
        iteration,
        items: [...items, ...dependencies],
        relationshipResets: matchingItems
          .filter((item) => item.content !== null)
          .map((item) => ({
            fromExternalId: item.content!.id,
            kind: "blocked_by" as const,
          })),
        relationships,
        events: [
          ...items.map((item) => ({
            externalId: `${item.externalId}:${item.updatedAt}`,
            workItemExternalId: item.externalId,
            kind: "observed_update",
            occurredAt: item.updatedAt,
            actor: null,
            url: item.url,
            payload: { status: item.status, source: "github_project" },
          })),
          ...evidenceEvents,
        ],
        cursor: project.items.pageInfo.endCursor,
      };

      after = project.items.pageInfo.hasNextPage
        ? project.items.pageInfo.endCursor
        : null;
    } while (after);

    if (!foundIteration) {
      throw new Error(
        `Iteration ${this.options.iterationId} was not found in ${this.connectionExternalId}`,
      );
    }
  }

  private normalizeIteration(
    project: ProjectData,
    items: ProjectItem[],
  ): NormalizedIteration | null {
    const value = items
      .map((item) => findIteration(item, this.options.iterationId))
      .find((iteration) => iteration !== undefined);
    if (!value?.title || !value.startDate || value.duration === undefined) return null;

    return {
      externalId: this.options.iterationId,
      name: value.title,
      goal: project.shortDescription,
      startsAt: value.startDate,
      endsAt: addDays(value.startDate, value.duration),
      raw: {
        projectId: project.id,
        projectTitle: project.title,
        iteration: value,
      },
    };
  }

  private async fetchProject(after: string | null): Promise<ProjectData> {
    this.requestCount += 1;
    const response = await this.request("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.options.token}`,
        "content-type": "application/json",
        "x-github-api-version": "2026-03-10",
      },
      body: JSON.stringify({
        query: PROJECT_QUERY,
        variables: {
          owner: this.options.owner,
          number: this.options.projectNumber,
          after,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`GitHub GraphQL request failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as GraphQLResponse<QueryData>;
    if (payload.errors?.length) {
      throw new Error(
        `GitHub GraphQL error: ${payload.errors.map((error) => error.message).join("; ")}`,
      );
    }

    const project = payload.data?.repositoryOwner?.projectV2;
    if (!project) {
      throw new Error(
        `GitHub Project ${this.options.owner}/${this.options.projectNumber} was not found`,
      );
    }
    return project;
  }
}
