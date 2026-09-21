import type {
  ActivityEvent,
  ComparisonWindow,
  QualityMetrics,
  SprintSnapshot,
  SyncMetrics,
} from "../domain/types";

interface DashboardResponse {
  baseline: SprintSnapshot;
  current: SprintSnapshot;
  events: ActivityEvent[];
  window: ComparisonWindow;
  syncMetrics: SyncMetrics | null;
  qualityMetrics: QualityMetrics;
  source: "ledger";
}

export async function loadDashboard(
  signal?: AbortSignal,
  since: string | null = null,
): Promise<DashboardResponse> {
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  const response = await fetch(`/api/dashboard${query}`, { signal });
  if (!response.ok) {
    throw new Error(`Dashboard request failed with HTTP ${response.status}`);
  }
  return (await response.json()) as DashboardResponse;
}
