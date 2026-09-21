import type {
  ConnectorBatch,
  NormalizedIteration,
  NormalizedWorkItem,
  SourceConnector,
} from "./types.js";

const PROJECT_QUERY = `
  query SprintIntelligenceProject($owner: String!, $number: Int!, $after: String) {
    organization(login: $owner) {
      projectV2(number: $number) { ...ProjectData }
    }
    user(login: $owner) {
      projectV2(number: $number) { ...ProjectData }
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
            comments { totalCount }
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
            comments { totalCount }
            repository { nameWithOwner }
          }
        }
      }
    }
  }
`;

interface GitHubProjectConnectorOptions {
  owner: string;
  projectNumber: number;
  iterationId: string;
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
  content: {
    id: string;
    number: number;
    title: string;
    url: string;
    updatedAt: string;
    state: string;
    reviewDecision?: string | null;
    assignees: { nodes: Array<{ login: string }> };
    comments: { totalCount: number };
    repository: { nameWithOwner: string };
  } | null;
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
  organization: { projectV2: ProjectData | null } | null;
  user: { projectV2: ProjectData | null } | null;
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

export class GitHubProjectConnector implements SourceConnector {
  readonly provider = "github";
  readonly connectionExternalId: string;
  readonly displayName: string;
  private readonly request: typeof fetch;

  constructor(private readonly options: GitHubProjectConnectorOptions) {
    this.connectionExternalId = `${options.owner}/projects/${options.projectNumber}`;
    this.displayName = `${options.owner} · Project ${options.projectNumber}`;
    this.request = options.fetch ?? fetch;
  }

  async *pull(_cursor: string | null): AsyncIterable<ConnectorBatch> {
    let after: string | null = null;
    let foundIteration = false;

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

      yield {
        iteration,
        items,
        relationships: [],
        events: items.map((item) => ({
          externalId: `${item.externalId}:${item.updatedAt}`,
          workItemExternalId: item.externalId,
          kind: "observed_update",
          occurredAt: item.updatedAt,
          actor: null,
          url: item.url,
          payload: { status: item.status, source: "github_project" },
        })),
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

    const project =
      payload.data?.organization?.projectV2 ?? payload.data?.user?.projectV2;
    if (!project) {
      throw new Error(
        `GitHub Project ${this.options.owner}/${this.options.projectNumber} was not found`,
      );
    }
    return project;
  }
}
