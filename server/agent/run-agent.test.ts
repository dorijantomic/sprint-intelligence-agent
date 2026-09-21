import { afterEach, describe, expect, it, vi } from "vitest";
import { seedDemoLedger } from "../fixtures/seed-demo.js";
import { SprintLedger } from "../ledger/ledger.js";
import { runSprintAgent } from "./run-agent.js";
import type {
  AgentFunctionTool,
  AgentRuntime,
  AgentTurnResult,
} from "./runtime/types.js";

function modelTurn(
  name: string,
  argumentsValue: Record<string, unknown>,
): AgentTurnResult {
  return {
    toolCall: {
      id: `call-${name}`,
      name,
      arguments: JSON.stringify(argumentsValue),
    },
    usage: { inputTokens: 20, outputTokens: 10 },
  };
}

function fakeRuntime(nextTurn: AgentRuntime["nextTurn"]): AgentRuntime {
  return {
    provider: "test-provider",
    model: "test-model",
    nextTurn,
  };
}

describe("runSprintAgent", () => {
  let ledger: SprintLedger | undefined;

  afterEach(() => ledger?.close());

  it("uses the deterministic evidence-backed path without an agent runtime", async () => {
    ledger = new SprintLedger();
    seedDemoLedger(ledger);

    const answer = await runSprintAgent(ledger, "What is blocked?", {
      runtime: null,
    });

    expect(answer.mode).toBe("deterministic");
    expect(answer.fallbackReason).toBe("agent_not_configured");
    expect(answer.answer).toContain("#142");
    expect(answer.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "work-item:#142" }),
        expect.objectContaining({ id: "work-item:#139" }),
      ]),
    );
    expect(answer.toolsUsed.map((tool) => tool.name)).toContain(
      "list_sprint_risks",
    );
    expect(ledger.count("agent_runs")).toBe(1);
  });

  it("executes agent-selected tools and accepts only retrieved citations", async () => {
    ledger = new SprintLedger();
    seedDemoLedger(ledger);
    const nextTurn = vi
      .fn()
      .mockResolvedValueOnce(
        modelTurn("list_sprint_risks", {
          kind: "blocked",
          severity: "all",
          limit: 10,
        }),
      )
      .mockResolvedValueOnce(
        modelTurn("submit_answer", {
          claims: [
            {
              text: "#142 is blocked by #139.",
              kind: "fact",
              confidence: "high",
              factIds: ["risk:#142-blocked"],
            },
          ],
        }),
      );

    const answer = await runSprintAgent(ledger, "What is blocked?", {
      runtime: fakeRuntime(nextTurn),
    });

    expect(answer.mode).toBe("agent");
    expect(answer.fallbackReason).toBeNull();
    expect(answer.answer).toBe("#142 is blocked by #139.");
    expect(answer.evidence.map((item) => item.id)).toEqual([
      "work-item:#142",
      "work-item:#139",
    ]);
    expect(answer.toolsUsed).toHaveLength(1);
    expect(answer.telemetry).toEqual(
      expect.objectContaining({ modelCalls: 2, inputTokens: 40, outputTokens: 20 }),
    );
    expect(answer.provider).toBe("test-provider");
    expect(nextTurn).toHaveBeenCalledTimes(2);
    expect(
      nextTurn.mock.calls[0]?.[0].tools.map(
        (tool: AgentFunctionTool) => tool.name,
      ),
    ).not.toContain("submit_answer");
    expect(
      nextTurn.mock.calls[1]?.[0].tools.map(
        (tool: AgentFunctionTool) => tool.name,
      ),
    ).toContain("submit_answer");
  });

  it("falls back when an agent cites evidence it never retrieved", async () => {
    ledger = new SprintLedger();
    seedDemoLedger(ledger);
    const nextTurn = vi
      .fn()
      .mockResolvedValueOnce(modelTurn("get_sprint_overview", {}))
      .mockResolvedValueOnce(
        modelTurn("submit_answer", {
          claims: [
            {
              text: "A production outage occurred.",
              kind: "fact",
              confidence: "high",
              factIds: ["invented:fact"],
            },
          ],
        }),
      );

    const answer = await runSprintAgent(ledger, "What changed?", {
      runtime: fakeRuntime(nextTurn),
    });

    expect(answer.mode).toBe("deterministic");
    expect(answer.fallbackReason).toBe("agent_error");
    expect(answer.answer).not.toContain("production outage");
    expect(answer.evidence.every((item) => item.url.startsWith("https://"))).toBe(
      true,
    );
  });

  it("forces submission after four read calls", async () => {
    ledger = new SprintLedger();
    seedDemoLedger(ledger);
    const nextTurn = vi
      .fn()
      .mockResolvedValueOnce(modelTurn("get_sprint_overview", {}))
      .mockResolvedValueOnce(modelTurn("list_sprint_changes", { kind: "all", limit: 20 }))
      .mockResolvedValueOnce(modelTurn("list_sprint_activity", { kind: "all", item_id: null, limit: 20 }))
      .mockResolvedValueOnce(modelTurn("list_sprint_risks", { kind: "all", severity: "all", limit: 20 }))
      .mockResolvedValueOnce(modelTurn("submit_answer", {
        claims: [{
          text: "#142 is blocked by #139.",
          kind: "fact",
          confidence: "high",
          factIds: ["risk:#142-blocked"],
        }],
      }));

    const answer = await runSprintAgent(ledger, "Give me a complete brief", {
      runtime: fakeRuntime(nextTurn),
    });

    expect(answer.mode).toBe("agent");
    expect(answer.telemetry.modelCalls).toBe(5);
    expect(nextTurn.mock.calls[4]?.[0].tools.map(
      (tool: AgentFunctionTool) => tool.name,
    )).toEqual(["submit_answer"]);
  });
});
