import type { SprintSnapshot } from "../domain/types";

interface DashboardResponse {
  baseline: SprintSnapshot;
  current: SprintSnapshot;
  source: "ledger";
}

export async function loadDashboard(
  signal?: AbortSignal,
): Promise<DashboardResponse> {
  const response = await fetch("/api/dashboard", { signal });
  if (!response.ok) {
    throw new Error(`Dashboard request failed with HTTP ${response.status}`);
  }
  return (await response.json()) as DashboardResponse;
}
