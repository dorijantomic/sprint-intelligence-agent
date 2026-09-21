import type {
  ConnectorBatch,
  NormalizedRelationshipMutation,
  NormalizedWorkItem,
  SourceConnector,
} from "./types.js";

export interface JiraSprintConnectorOptions {
  baseUrl: string;
  email: string;
  apiToken: string;
  sprintId: number;
  sprintName?: string;
  storyPointField?: string | null;
  fetch?: typeof fetch;
}

interface JiraSprint {
  id: number;
  name: string;
  goal?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

interface JiraUser {
  displayName?: string;
}

interface JiraIssueReference {
  id: string;
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string };
    priority?: { name?: string } | null;
    assignee?: JiraUser | null;
    updated?: string;
    issuetype?: { name?: string };
  };
}

interface JiraIssueLink {
  id: string;
  type: { inward?: string; outward?: string };
  inwardIssue?: JiraIssueReference;
  outwardIssue?: JiraIssueReference;
}

interface JiraIssue extends JiraIssueReference {
  fields: JiraIssueReference["fields"] & {
    comment?: { total?: number };
    issuelinks?: JiraIssueLink[];
    [field: string]: unknown;
  };
}

interface JiraIssuePage {
  issues: JiraIssue[];
  startAt?: number;
  maxResults?: number;
  total?: number;
  isLast?: boolean;
  nextPageToken?: string;
}

interface JiraComment {
  id: string;
  body?: unknown;
  author?: JiraUser;
  created: string;
  updated?: string;
  self?: string;
}

interface JiraCommentPage {
  comments: JiraComment[];
  startAt: number;
  maxResults: number;
  total: number;
}

export class JiraApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "JiraApiError";
  }
}

function slug(value: string | undefined, fallback: string): string {
  return (value ?? fallback).trim().toLowerCase().replaceAll(/\s+/g, "_");
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function issueUrl(baseUrl: string, key: string): string {
  return `${baseUrl}/browse/${encodeURIComponent(key)}`;
}

function normalizeIssue(
  baseUrl: string,
  sprintId: number,
  storyPointField: string,
  issue: JiraIssue,
): NormalizedWorkItem {
  return {
    externalId: issue.id,
    iterationExternalId: String(sprintId),
    key: issue.key,
    title: issue.fields.summary ?? issue.key,
    kind: "task",
    status: slug(issue.fields.status?.name, "unknown"),
    priority: issue.fields.priority?.name?.toLowerCase() ?? null,
    assignee: issue.fields.assignee?.displayName ?? null,
    estimate: numeric(issue.fields[storyPointField]),
    commentCount: issue.fields.comment?.total ?? 0,
    reviewState: "none",
    updatedAt: issue.fields.updated ?? new Date(0).toISOString(),
    url: issueUrl(baseUrl, issue.key),
    raw: issue,
  };
}

function normalizeReference(
  baseUrl: string,
  reference: JiraIssueReference,
): NormalizedWorkItem {
  return {
    externalId: reference.id,
    iterationExternalId: null,
    key: reference.key,
    title: reference.fields.summary ?? reference.key,
    kind: "task",
    status: slug(reference.fields.status?.name, "unknown"),
    priority: reference.fields.priority?.name?.toLowerCase() ?? null,
    assignee: reference.fields.assignee?.displayName ?? null,
    estimate: null,
    commentCount: 0,
    reviewState: "none",
    updatedAt: reference.fields.updated ?? new Date(0).toISOString(),
    url: issueUrl(baseUrl, reference.key),
    raw: reference,
  };
}

function blockersFor(issue: JiraIssue): Array<{
  blocked: JiraIssueReference;
  blocker: JiraIssueReference;
}> {
  const pairs: Array<{ blocked: JiraIssueReference; blocker: JiraIssueReference }> = [];
  for (const link of issue.fields.issuelinks ?? []) {
    if (link.inwardIssue && /block/i.test(link.type.inward ?? "")) {
      pairs.push({ blocked: issue, blocker: link.inwardIssue });
    }
    if (link.outwardIssue && /block/i.test(link.type.outward ?? "")) {
      pairs.push({ blocked: link.outwardIssue, blocker: issue });
    }
  }
  return pairs;
}

function commentText(body: unknown): string | null {
  if (typeof body === "string") return body;
  if (!body || typeof body !== "object") return null;
  const text: string[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const value = node as { text?: unknown; content?: unknown };
    if (typeof value.text === "string") text.push(value.text);
    if (Array.isArray(value.content)) value.content.forEach(visit);
  };
  visit(body);
  return text.join(" ").trim() || null;
}

export class JiraSprintConnector implements SourceConnector {
  readonly provider = "jira";
  readonly connectionExternalId: string;
  readonly displayName: string;
  requestCount = 0;
  private readonly baseUrl: string;
  private readonly request: typeof fetch;
  private readonly headers: HeadersInit;

  constructor(private readonly options: JiraSprintConnectorOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.connectionExternalId = `${this.baseUrl}/sprints/${options.sprintId}`;
    this.displayName = `Jira · ${options.sprintName ?? `Sprint ${options.sprintId}`}`;
    this.request = options.fetch ?? fetch;
    this.headers = {
      accept: "application/json",
      authorization: `Basic ${Buffer.from(`${options.email}:${options.apiToken}`).toString("base64")}`,
    };
  }

  async *pull(_cursor: string | null): AsyncIterable<ConnectorBatch> {
    const sprint = await this.get<JiraSprint>(
      `/rest/agile/1.0/sprint/${this.options.sprintId}`,
    );
    const issues = await this.fetchIssues();
    const storyPointField = this.options.storyPointField ?? "customfield_10016";
    const items = issues.map((issue) =>
      normalizeIssue(this.baseUrl, this.options.sprintId, storyPointField, issue),
    );
    const itemIds = new Set(items.map((item) => item.externalId));
    const relationships: NormalizedRelationshipMutation[] = [];
    const dependencies = new Map<string, NormalizedWorkItem>();
    for (const issue of issues) {
      for (const pair of blockersFor(issue)) {
        relationships.push({
          action: "upsert",
          fromExternalId: pair.blocked.id,
          toExternalId: pair.blocker.id,
          kind: "blocked_by",
          observedAt: issue.fields.updated ?? new Date().toISOString(),
        });
        for (const reference of [pair.blocked, pair.blocker]) {
          if (!itemIds.has(reference.id)) {
            dependencies.set(reference.id, normalizeReference(this.baseUrl, reference));
          }
        }
      }
    }
    const comments: ConnectorBatch["events"] = [];
    for (let index = 0; index < issues.length; index += 5) {
      const commentPages = await Promise.all(
        issues.slice(index, index + 5).map(async (issue) => ({
          issue,
          comments: await this.fetchComments(issue.key),
        })),
      );
      comments.push(...commentPages.flatMap(({ issue, comments: issueComments }) =>
        issueComments.map((comment) => ({
          externalId: `jira-comment:${comment.id}`,
          workItemExternalId: issue.id,
          kind: "commented",
          occurredAt: comment.created,
          actor: comment.author?.displayName ?? null,
          url: `${issueUrl(this.baseUrl, issue.key)}?focusedCommentId=${comment.id}`,
          payload: {
            body: commentText(comment.body),
            updatedAt: comment.updated ?? comment.created,
            source: "jira",
          },
        })),
      ));
    }

    yield {
      iteration: {
        externalId: String(sprint.id),
        name: sprint.name,
        goal: sprint.goal ?? null,
        startsAt: sprint.startDate ?? null,
        endsAt: sprint.endDate ?? null,
        raw: sprint,
      },
      items: [...items, ...dependencies.values()],
      relationshipResets: items.map((item) => ({
        fromExternalId: item.externalId,
        kind: "blocked_by" as const,
      })),
      relationships,
      events: [
        ...items.map((item) => ({
          externalId: `jira-observed:${item.externalId}:${item.updatedAt}`,
          workItemExternalId: item.externalId,
          kind: "observed_update",
          occurredAt: item.updatedAt,
          actor: null,
          url: item.url,
          payload: { status: item.status, source: "jira" },
        })),
        ...comments,
      ],
      cursor: new Date().toISOString(),
    };
  }

  private async fetchIssues(): Promise<JiraIssue[]> {
    const issues: JiraIssue[] = [];
    let startAt = 0;
    const storyPointField = this.options.storyPointField ?? "customfield_10016";
    while (true) {
      const query = new URLSearchParams({
        startAt: String(startAt),
        maxResults: "50",
        fields: [
          "summary", "status", "priority", "assignee", "updated",
          "issuetype", "comment", "issuelinks", storyPointField,
        ].join(","),
      });
      const page = await this.get<JiraIssuePage>(
        `/rest/agile/1.0/sprint/${this.options.sprintId}/issue?${query}`,
      );
      issues.push(...page.issues);
      const pageSize = page.maxResults ?? page.issues.length;
      const total = page.total ?? issues.length;
      if (page.isLast === true || page.issues.length === 0 || startAt + pageSize >= total) break;
      startAt += pageSize;
    }
    return issues;
  }

  private async fetchComments(issueKey: string): Promise<JiraComment[]> {
    const comments: JiraComment[] = [];
    let startAt = 0;
    while (true) {
      const page = await this.get<JiraCommentPage>(
        `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?startAt=${startAt}&maxResults=100&orderBy=created`,
      );
      comments.push(...page.comments);
      if (startAt + page.maxResults >= page.total || page.comments.length === 0) break;
      startAt += page.maxResults;
    }
    return comments;
  }

  private async get<T>(path: string): Promise<T> {
    this.requestCount += 1;
    const response = await this.request(`${this.baseUrl}${path}`, {
      headers: this.headers,
    });
    if (!response.ok) {
      throw new JiraApiError(
        `Jira request failed with HTTP ${response.status}`,
        response.status,
      );
    }
    return response.json() as Promise<T>;
  }
}
