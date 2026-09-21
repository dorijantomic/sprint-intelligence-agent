import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { seedDemoLedger } from "../fixtures/seed-demo.js";
import { SprintLedger } from "../ledger/ledger.js";
import { createApiServer } from "./server.js";

describe("dashboard API", () => {
  const servers: Server[] = [];
  const ledgers: SprintLedger[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) => new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
    ledgers.splice(0).forEach((ledger) => ledger.close());
  });

  it("serves persisted baseline and current sprint snapshots", async () => {
    const ledger = new SprintLedger();
    ledgers.push(ledger);
    seedDemoLedger(ledger);
    const server = createApiServer(ledger);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/dashboard`,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source).toBe("ledger");
    expect(body.baseline.items).toHaveLength(5);
    expect(body.current.items).toHaveLength(6);
    expect(body.current.items).toContainEqual(
      expect.objectContaining({ id: "#142", blockedBy: ["#139"] }),
    );
  });
});
