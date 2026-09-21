import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceSecretStore } from "../config/source-secrets.js";
import { AtlassianOAuth } from "./atlassian-oauth.js";

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("AtlassianOAuth", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ));
  });

  it("validates state, stores the grant, refreshes it, and discovers Jira", async () => {
    const directory = await mkdtemp(join(tmpdir(), "orbit-atlassian-oauth-"));
    directories.push(directory);
    const secrets = new SourceSecretStore(join(directory, "secrets.json"));
    let now = 1_800_000_000_000;
    let tokenCalls = 0;
    const request = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "https://auth.atlassian.com/oauth/token") {
        tokenCalls += 1;
        const body = JSON.parse(String(init?.body)) as { grant_type: string };
        return body.grant_type === "authorization_code"
          ? json({ access_token: "access-one", refresh_token: "refresh-one", expires_in: 120 })
          : json({ access_token: "access-two", refresh_token: "refresh-two", expires_in: 3600 });
      }
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer access-two");
      if (url.endsWith("/oauth/token/accessible-resources")) {
        return json([{ id: "cloud-1", name: "Acme", url: "https://acme.atlassian.net" }]);
      }
      if (url.includes("/rest/agile/1.0/board?") && !url.includes("/configuration")) {
        return json({ isLast: true, values: [{ id: 34, name: "Delivery", type: "scrum", location: { projectKey: "DEL" } }] });
      }
      if (url.includes("/sprint?")) {
        return json({ values: [{ id: 7, name: "Sprint 7", state: "active" }] });
      }
      if (url.endsWith("/configuration")) {
        return json({ estimation: { field: { fieldId: "customfield_10016" } } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const oauth = new AtlassianOAuth({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "http://localhost:8787/api/auth/atlassian/callback",
      secrets,
      request,
      now: () => now,
    });

    const authorizationUrl = new URL(await oauth.authorizationUrl());
    expect(authorizationUrl.origin).toBe("https://auth.atlassian.com");
    expect(authorizationUrl.searchParams.get("scope")).toContain("offline_access");
    await oauth.complete("authorization-code", authorizationUrl.searchParams.get("state")!);
    expect(await oauth.status()).toEqual({ configured: true, connected: true, missing: [] });

    now += 70_000;
    expect(await oauth.getAccessToken()).toBe("access-two");
    expect(await oauth.getAccessToken()).toBe("access-two");
    expect(tokenCalls).toBe(2);
    expect(await oauth.listSites()).toEqual([{ id: "cloud-1", name: "Acme", url: "https://acme.atlassian.net" }]);
    expect(await oauth.listBoards("cloud-1")).toEqual([{ id: 34, name: "Delivery", type: "scrum", projectKey: "DEL" }]);
    expect(await oauth.listSprints("cloud-1", 34)).toEqual({
      sprints: [{ id: 7, name: "Sprint 7", state: "active", startDate: null, endDate: null }],
      storyPointField: "customfield_10016",
    });
  });

  it("rejects an invalid callback state before exchanging a token", async () => {
    const directory = await mkdtemp(join(tmpdir(), "orbit-atlassian-state-"));
    directories.push(directory);
    const request = vi.fn<typeof fetch>();
    const oauth = new AtlassianOAuth({
      clientId: "client-id",
      clientSecret: "client-secret",
      secrets: new SourceSecretStore(join(directory, "secrets.json")),
      request,
    });
    await oauth.authorizationUrl();

    await expect(oauth.complete("code", "wrong-state")).rejects.toThrow("invalid or expired");
    expect(request).not.toHaveBeenCalled();
  });

  it("accepts app credentials from the UI without returning the secret", async () => {
    const directory = await mkdtemp(join(tmpdir(), "orbit-atlassian-config-"));
    directories.push(directory);
    const oauth = new AtlassianOAuth({
      clientId: "",
      clientSecret: "",
      secrets: new SourceSecretStore(join(directory, "secrets.json")),
    });

    expect(await oauth.status()).toEqual({
      configured: false,
      connected: false,
      missing: ["client ID", "client secret"],
    });
    const status = await oauth.configure("ui-client-id", "ui-client-secret");
    const authorizationUrl = new URL(await oauth.authorizationUrl());

    expect(status).toEqual({ configured: true, connected: false, missing: [] });
    expect(JSON.stringify(status)).not.toContain("ui-client-secret");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("ui-client-id");
  });
});
