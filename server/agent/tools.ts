import {
  analyzeSprint,
  activityEventsToChanges,
} from "../../src/domain/analyzeSprint.js";
import type {
  ActivityEvent,
  ComparisonWindow,
  EvidenceLink,
  SprintAnalysis,
  SprintSnapshot,
  WorkItem,
} from "../../src/domain/types.js";
import { serializeSnapshot } from "../api/dashboard.js";
import { SprintLedger } from "../ledger/ledger.js";
import type { AgentToolTrace } from "./types.js";
import type { AgentFunctionTool } from "./runtime/types.js";

const emptyParameters = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
} as const;

export const ledgerToolDefinitions: AgentFunctionTool[] = [
  {
    name: "get_sprint_overview",
    description:
      "Get the current sprint, comparison window, aggregate progress, and item-level evidence. Call this before making sprint-wide claims.",
    parameters: emptyParameters,
  },
  {
    name: "list_sprint_changes",
    description:
      "List evidence-backed changes between the baseline and current sprint snapshots, including exact comment and review activity.",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["all", "added", "removed", "status", "assignee", "comments", "review"],
        },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["kind", "limit"],
      additionalProperties: false,
    },
  },
  {
    name: "list_sprint_risks",
    description:
      "List deterministic sprint risk signals. Facts and severities come from rules, not model judgment.",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["all", "blocked", "stale", "scope_change", "review", "unowned"],
        },
        severity: {
          type: "string",
          enum: ["all", "low", "medium", "high"],
        },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["kind", "severity", "limit"],
      additionalProperties: false,
    },
  },
  {
    name: "get_work_item",
    description:
      "Get one current sprint item and recursively trace its blocked-by chain. Use the exact item ID shown by another tool.",
    parameters: {
      type: "object",
      properties: {
        item_id: { type: "string" },
      },
      required: ["item_id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_sprint_activity",
    description:
      "List exact comments, reviews, and observed updates recorded inside the snapshot comparison window.",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["all", "commented", "reviewed", "observed_update"],
        },
        item_id: { type: ["string", "null"] },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["kind", "item_id", "limit"],
      additionalProperties: false,
    },
  },
];

type LedgerToolName =
  | "get_sprint_overview"
  | "list_sprint_changes"
  | "list_sprint_risks"
  | "get_work_item"
  | "list_sprint_activity";

interface ToolContext {
  baseline: SprintSnapshot;
  current: SprintSnapshot;
  events: ActivityEvent[];
  analysis: SprintAnalysis;
  window: ComparisonWindow;
}

export interface LedgerFact {
  id: string;
  statement: string;
  evidenceIds: string[];
}

function boundedLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return 20;
  return Math.min(50, Math.max(1, parsed));
}

export class SprintLedgerTools {
  readonly evidence = new Map<string, EvidenceLink>();
  readonly facts = new Map<string, LedgerFact>();
  readonly trace: AgentToolTrace[] = [];
  private readonly context: ToolContext;

  constructor(
    private readonly ledger: SprintLedger,
    options: { since?: string | null } = {},
  ) {
    const storedWindow = ledger.getComparisonWindow(options.since ?? null);
    const currentStored = storedWindow.current;
    const baselineStored = storedWindow.baseline;
    const current = serializeSnapshot(currentStored);
    const baseline = serializeSnapshot(baselineStored);
    const events = ledger.getEventsSince(
      current.id,
      storedWindow.effectiveSince,
    );
    this.context = {
      baseline,
      current,
      events,
      analysis: analyzeSprint(baseline, current),
      window: {
        requestedSince: storedWindow.requestedSince,
        effectiveSince: storedWindow.effectiveSince,
        baselineCapturedAt: baseline.capturedAt,
        currentCapturedAt: current.capturedAt,
        coverageComplete: storedWindow.coverageComplete,
        strategy: storedWindow.strategy,
      },
    };
    this.registerSnapshot(
      current.id,
      current.sprintName,
      currentStored.sourceUrl ?? current.items[0]?.url ?? null,
    );
  }

  get snapshotId(): string {
    return this.context.current.id;
  }

  get analysisContext(): Readonly<ToolContext> {
    return this.context;
  }

  execute(name: string, rawArguments: string): unknown {
    if (!ledgerToolDefinitions.some((tool) => tool.name === name)) {
      throw new Error(`Unknown read tool: ${name}`);
    }
    const args = JSON.parse(rawArguments || "{}") as Record<string, unknown>;
    let result: unknown;

    switch (name as LedgerToolName) {
      case "get_sprint_overview":
        result = this.overview();
        break;
      case "list_sprint_changes":
        result = this.changes(args);
        break;
      case "list_sprint_risks":
        result = this.risks(args);
        break;
      case "get_work_item":
        result = this.workItem(args);
        break;
      case "list_sprint_activity":
        result = this.activity(args);
        break;
    }

    const evidenceIds = this.collectEvidenceIds(result);
    this.trace.push({
      name,
      arguments: args,
      evidenceIds,
      resultCount: this.resultCount(result),
    });
    return result;
  }

  private overview(): unknown {
    const { baseline, current, analysis, window } = this.context;
    const evidenceIds = current.items.map((item) => this.registerItem(item));
    const factId = this.registerFact(
      `overview:${current.id}`,
      `${current.sprintName} has ${current.items.length} items, ${analysis.completedCount} completed, ${analysis.activeCount} active, ${analysis.addedCount} added, and ${analysis.risks.length} deterministic risks between ${baseline.capturedAt} and ${current.capturedAt}.`,
      [this.snapshotEvidenceId(current.id), ...evidenceIds],
    );
    return {
      sprint: {
        name: current.sprintName,
        source: current.sourceName,
        baselineCapturedAt: baseline.capturedAt,
        currentCapturedAt: current.capturedAt,
        requestedSince: window.requestedSince,
        effectiveSince: window.effectiveSince,
        coverageComplete: window.coverageComplete,
      },
      progress: {
        itemCount: current.items.length,
        completedCount: analysis.completedCount,
        activeCount: analysis.activeCount,
        addedCount: analysis.addedCount,
        completedPoints: analysis.completedPoints,
        totalPoints: analysis.totalPoints,
      },
      riskCount: analysis.risks.length,
      changeCount: analysis.changes.length,
      factIds: [factId],
      evidenceIds: [this.snapshotEvidenceId(current.id), ...evidenceIds],
    };
  }

  private changes(args: Record<string, unknown>): unknown {
    const selectedKind = String(args.kind ?? "all");
    const eventChanges = activityEventsToChanges(this.context.events);
    const exactEventItems = new Set(
      eventChanges
        .filter((change) => change.kind === "comments" || change.kind === "review")
        .map((change) => `${change.itemId}:${change.kind}`),
    );
    const changes = [
      ...this.context.analysis.changes.filter(
        (change) => !exactEventItems.has(`${change.itemId}:${change.kind}`),
      ),
      ...eventChanges,
    ]
      .filter((change) => selectedKind === "all" || change.kind === selectedKind)
      .sort(
        (left, right) =>
          new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
      )
      .slice(0, boundedLimit(args.limit))
      .map((change) => {
        const event = change.id.startsWith("event-")
          ? this.context.events.find((item) => `event-${item.id}` === change.id)
          : null;
        const evidenceId = event
          ? this.registerEvent(event)
          : this.registerItemById(change.itemId);
        const evidenceIds = evidenceId ? [evidenceId] : [];
        const factId = this.registerFact(
          `change:${change.id}`,
          change.summary,
          evidenceIds,
        );
        return { ...change, factId, evidenceIds };
      });
    return { changes, evidence: this.linksFor(changes.flatMap((item) => item.evidenceIds)) };
  }

  private risks(args: Record<string, unknown>): unknown {
    const selectedKind = String(args.kind ?? "all");
    const selectedSeverity = String(args.severity ?? "all");
    const risks = this.context.analysis.risks
      .filter((risk) => selectedKind === "all" || risk.kind === selectedKind)
      .filter(
        (risk) => selectedSeverity === "all" || risk.severity === selectedSeverity,
      )
      .slice(0, boundedLimit(args.limit))
      .map((risk) => {
        const evidenceIds = risk.evidenceIds
          .map((itemId) => this.registerItemById(itemId))
          .filter((id): id is string => id !== null);
        const factId = this.registerFact(
          `risk:${risk.id}`,
          `${risk.itemId}: ${risk.title}. ${risk.reason}`,
          evidenceIds,
        );
        return { ...risk, factId, evidenceIds };
      });
    return { risks, evidence: this.linksFor(risks.flatMap((item) => item.evidenceIds)) };
  }

  private workItem(args: Record<string, unknown>): unknown {
    const itemId = String(args.item_id ?? "");
    const item = this.context.current.items.find((candidate) => candidate.id === itemId);
    if (!item) {
      return { found: false, itemId, evidence: [] };
    }
    const paths: string[][] = [];
    const visit = (currentId: string, path: string[], visited: Set<string>) => {
      const current = this.context.current.items.find(
        (candidate) => candidate.id === currentId,
      );
      if (!current || current.blockedBy.length === 0) {
        if (path.length > 1) paths.push(path);
        return;
      }
      for (const blockerId of current.blockedBy) {
        if (visited.has(blockerId)) {
          paths.push([...path, blockerId]);
          continue;
        }
        visit(blockerId, [...path, blockerId], new Set([...visited, blockerId]));
      }
    };
    visit(item.id, [item.id], new Set([item.id]));
    const relatedIds = new Set([item.id, ...paths.flat()]);
    const evidenceIds = [...relatedIds]
      .map((id) => this.registerItemById(id))
      .filter((id): id is string => id !== null);
    const factIds = [
      this.registerFact(
        `work-item:${item.id}:state`,
        `${item.id} is ${item.status}, priority ${item.priority}, assigned to ${item.assignee ?? "nobody"}, with review state ${item.reviewState}.`,
        [this.registerItem(item)],
      ),
      ...paths.map((path, index) =>
        this.registerFact(
          `work-item:${item.id}:blocker-chain:${index}`,
          `${item.id} blocker chain: ${path.join(" → ")}.`,
          path
            .map((id) => this.registerItemById(id))
            .filter((id): id is string => id !== null),
        ),
      ),
    ];
    return {
      found: true,
      item,
      blockerChains: paths,
      factIds,
      evidenceIds,
      evidence: this.linksFor(evidenceIds),
    };
  }

  private activity(args: Record<string, unknown>): unknown {
    const selectedKind = String(args.kind ?? "all");
    const selectedItemId = args.item_id === null ? null : String(args.item_id ?? "");
    const events = this.context.events
      .filter((event) => selectedKind === "all" || event.kind === selectedKind)
      .filter((event) => !selectedItemId || event.itemId === selectedItemId)
      .slice(0, boundedLimit(args.limit))
      .map((event) => {
        const evidenceIds = [this.registerEvent(event)];
        const factId = this.registerFact(
          `activity:${event.id}`,
          `${event.actor ?? "Someone"} ${event.kind} on ${event.itemId} at ${event.occurredAt}.`,
          evidenceIds,
        );
        return { ...event, factId, evidenceIds };
      });
    return { events, evidence: this.linksFor(events.flatMap((item) => item.evidenceIds)) };
  }

  private registerSnapshot(id: string, label: string, url: string | null): void {
    if (!url) return;
    this.evidence.set(this.snapshotEvidenceId(id), {
      id: this.snapshotEvidenceId(id),
      label: `${label} · snapshot`,
      url,
    });
  }

  private snapshotEvidenceId(id: string): string {
    return `snapshot:${id}`;
  }

  private registerItem(item: WorkItem): string {
    const id = `work-item:${item.id}`;
    this.evidence.set(id, { id, label: `${item.id} · ${item.title}`, url: item.url });
    return id;
  }

  private registerItemById(itemId: string): string | null {
    const item =
      this.context.current.items.find((candidate) => candidate.id === itemId) ??
      this.context.baseline.items.find((candidate) => candidate.id === itemId);
    if (item) return this.registerItem(item);
    const external = this.ledger.getWorkItemEvidence(
      this.context.current.id,
      itemId,
    );
    if (!external) return null;
    const id = `work-item:${external.itemKey}`;
    this.evidence.set(id, {
      id,
      label: `${external.itemKey} · ${external.title}`,
      url: external.url,
    });
    return id;
  }

  private registerEvent(event: ActivityEvent): string {
    const id = `event:${event.id}`;
    const fallbackUrl = this.context.current.items.find(
      (item) => item.id === event.itemId,
    )?.url;
    this.evidence.set(id, {
      id,
      label: `${event.itemId} · ${event.kind}`,
      url: event.url ?? fallbackUrl ?? "",
    });
    return id;
  }

  private linksFor(ids: string[]): EvidenceLink[] {
    return [...new Set(ids)]
      .map((id) => this.evidence.get(id))
      .filter((link): link is EvidenceLink => Boolean(link?.url));
  }

  private registerFact(
    id: string,
    statement: string,
    evidenceIds: string[],
  ): string {
    const supportedEvidence = [...new Set(evidenceIds)].filter((evidenceId) =>
      Boolean(this.evidence.get(evidenceId)?.url),
    );
    this.facts.set(id, { id, statement, evidenceIds: supportedEvidence });
    return id;
  }

  private collectEvidenceIds(result: unknown): string[] {
    const serialized = JSON.stringify(result);
    return [...this.evidence.keys()].filter((id) => serialized.includes(id));
  }

  private resultCount(result: unknown): number {
    if (!result || typeof result !== "object") return 0;
    for (const value of Object.values(result)) {
      if (Array.isArray(value)) return value.length;
    }
    return 1;
  }
}
