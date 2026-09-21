import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SourceSecretStore } from "./source-secrets.js";

describe("SourceSecretStore", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ));
  });

  it("stores connector credentials outside SQLite with owner-only access", async () => {
    const directory = await mkdtemp(join(tmpdir(), "orbit-source-secrets-"));
    directories.push(directory);
    const store = new SourceSecretStore(join(directory, "secrets.json"));

    await store.set("jira:https://example.atlassian.net/sprints/42", "token");

    expect(await store.get("jira:https://example.atlassian.net/sprints/42")).toBe("token");
    expect((await stat(store.path)).mode & 0o777).toBe(0o600);
  });
});
