import type { Response } from "openai/resources/responses/responses";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seedDemoLedger } from "../fixtures/seed-demo.js";
import { SprintLedger } from "../ledger/ledger.js";
import { runSprintAgent } from "./run-agent.js";

function modelResponse(
  name: string,
  argumentsValue: Record<string, unknown>,
): Response {
  return {
    output: [
      {
        type: "function_call",
        call_id: `call-${name}`,
        name,
        arguments: JSON.stringify(argumentsValue),
      },
    ],
    usage: { input_tokens: 20, output_tokens: 10 },
  } as unknown as Response;
}

describe("runSprintAgent", () => {
  let ledger: SprintLedger | undefined;

  afterEach(() => ledger?.close());

  it("uses the deterministic evidence-backed path without an API key", async () => {
    ledger = new SprintLedger();
    seedDemoLedger(ledger);

    const answer = await runSprintAgent(ledger, "What is blocked?", {
      apiKey: null,
    });

    expect(answer.mode).toBe("deterministic");
    expect(answer.fallbackReason).toBe("model_not_configured");
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

  it("executes model-selected tools and accepts only retrieved citations", async () => {
    ledger = new SprintLedger();
    seedDemoLedger(ledger);
    const createResponse = vi
      .fn()
      .mockResolvedValueOnce(
        modelResponse("list_sprint_risks", {
          kind: "blocked",
          severity: "all",
          limit: 10,
        }),
      )
      .mockResolvedValueOnce(
        modelResponse("submit_answer", {
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
      apiKey: "test-key",
      model: "test-model",
      createResponse,
    });

    expect(answer.mode).toBe("model");
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
    expect(createResponse).toHaveBeenCalledTimes(2);
  });

  it("falls back when a model cites evidence it never retrieved", async () => {
    ledger = new SprintLedger();
    seedDemoLedger(ledger);
    const createResponse = vi
      .fn()
      .mockResolvedValueOnce(modelResponse("get_sprint_overview", {}))
      .mockResolvedValueOnce(
        modelResponse("submit_answer", {
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
      apiKey: "test-key",
      createResponse,
    });

    expect(answer.mode).toBe("deterministic");
    expect(answer.fallbackReason).toBe("model_error");
    expect(answer.answer).not.toContain("production outage");
    expect(answer.evidence.every((item) => item.url.startsWith("https://"))).toBe(
      true,
    );
  });
});
