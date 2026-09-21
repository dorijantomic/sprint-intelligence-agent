import { afterEach, describe, expect, it } from "vitest";
import { seedDemoLedger } from "../fixtures/seed-demo.js";
import { SprintLedger } from "../ledger/ledger.js";
import { SprintLedgerTools } from "./tools.js";

describe("SprintLedgerTools", () => {
  let ledger: SprintLedger | undefined;

  afterEach(() => ledger?.close());

  it("exposes typed sprint facts with source evidence", () => {
    ledger = new SprintLedger();
    seedDemoLedger(ledger);
    const tools = new SprintLedgerTools(ledger);

    const overview = tools.execute(
      "get_sprint_overview",
      "{}",
    ) as { progress: { itemCount: number }; evidenceIds: string[] };
    const risks = tools.execute(
      "list_sprint_risks",
      JSON.stringify({ kind: "blocked", severity: "all", limit: 10 }),
    ) as { risks: Array<{ itemId: string; evidenceIds: string[] }> };
    const item = tools.execute(
      "get_work_item",
      JSON.stringify({ item_id: "#142" }),
    ) as { blockerChains: string[][]; evidenceIds: string[] };

    expect(overview.progress.itemCount).toBe(6);
    expect(overview.evidenceIds).toContain("work-item:#142");
    expect(risks.risks).toEqual([
      expect.objectContaining({
        itemId: "#142",
        evidenceIds: ["work-item:#142", "work-item:#139"],
      }),
    ]);
    expect(item.blockerChains).toEqual([["#142", "#139"]]);
    expect(item.evidenceIds).toEqual(["work-item:#142", "work-item:#139"]);
    expect(tools.evidence.get("work-item:#142")?.url).toContain("issues/142");
    expect(tools.trace.map((entry) => entry.name)).toEqual([
      "get_sprint_overview",
      "list_sprint_risks",
      "get_work_item",
    ]);
  });

  it("rejects tools outside the read-only registry", () => {
    ledger = new SprintLedger();
    seedDemoLedger(ledger);
    const tools = new SprintLedgerTools(ledger);

    expect(() => tools.execute("run_sql", '{"query":"DELETE"}')).toThrow(
      "Unknown read tool",
    );
  });
});
