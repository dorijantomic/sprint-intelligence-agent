import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  discoverProjects,
  loadConnections,
  saveGitHubConnection,
  syncConnection,
  type Connection,
  type GitHubProjectOption,
} from "./api/connections";
import { loadDashboard } from "./api/dashboard";
import {
  currentSnapshot,
  demoActivityEvents,
  demoQualityMetrics,
  demoSyncMetrics,
  mondaySnapshot,
} from "./data/demoSprint";
import {
  activityEventsToChanges,
  analyzeSprint,
  answerSprintQuestion,
  evidenceForSprintQuestion,
} from "./domain/analyzeSprint";
import type { SprintRisk, WorkStatus } from "./domain/types";

const statusLabel: Record<WorkStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
};

const suggestedQuestions = [
  "What changed since Monday?",
  "What is blocked?",
  "Show me the sprint risks",
  "Give me a holiday catch-up brief",
];

function Logo() {
  return (
    <div className="logo" aria-label="Orbit">
      <span className="logo-mark">O</span>
      <span>Orbit</span>
    </div>
  );
}

function EvidencePills({ ids }: { ids: string[] }) {
  return (
    <span className="evidence-list">
      {ids.map((id) => (
        <span className="evidence-pill" key={id}>
          {id}
        </span>
      ))}
    </span>
  );
}

function RiskCard({ risk }: { risk: SprintRisk }) {
  return (
    <article className={`risk-card severity-${risk.severity}`}>
      <div className="risk-card-topline">
        <span className="risk-severity">{risk.severity}</span>
        <span className="risk-kind">{risk.kind.replace("_", " ")}</span>
      </div>
      <h3>{risk.title}</h3>
      <p>{risk.reason}</p>
      <EvidencePills ids={risk.evidenceIds} />
    </article>
  );
}

interface SetupDialogProps {
  projects: GitHubProjectOption[] | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onDiscover: () => void;
  onSave: (project: GitHubProjectOption, iterationId: string) => void;
}

function SetupDialog({
  projects,
  loading,
  saving,
  error,
  onClose,
  onDiscover,
  onSave,
}: SetupDialogProps) {
  const usableProjects = projects?.filter((project) => project.iterations.length > 0);
  const firstProject = usableProjects?.[0];
  const [projectId, setProjectId] = useState(firstProject?.id ?? "");
  const project = projects?.find((item) => item.id === projectId) ?? firstProject;
  const currentIteration =
    project?.iterations.find((iteration) => !iteration.completed) ??
    project?.iterations[0];
  const [iterationId, setIterationId] = useState(currentIteration?.id ?? "");

  useEffect(() => {
    if (!projectId && firstProject) setProjectId(firstProject.id);
  }, [firstProject, projectId]);

  useEffect(() => {
    if (!project) return;
    if (!project.iterations.some((iteration) => iteration.id === iterationId)) {
      setIterationId(
        project.iterations.find((iteration) => !iteration.completed)?.id ??
          project.iterations[0]?.id ??
          "",
      );
    }
  }, [iterationId, project]);

  const iteration = project?.iterations.find((item) => item.id === iterationId);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="setup-title"
        aria-modal="true"
        className="setup-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">GITHUB CONNECTION</span>
            <h2 id="setup-title">Choose a sprint source</h2>
          </div>
          <button aria-label="Close setup" className="dialog-close" onClick={onClose}>×</button>
        </div>
        <p className="dialog-copy">
          Orbit reads projects available to your local GitHub CLI login. Your token stays on this machine and is never saved in SQLite.
        </p>

        {projects === null ? (
          <div className="discover-state">
            <span className="github-mark">GH</span>
            <strong>{loading ? "Finding your projects…" : "Ready to discover GitHub Projects"}</strong>
            <small>Requires the read:project scope you already approved.</small>
            {!loading && <button className="primary-action" onClick={onDiscover}>Discover projects</button>}
          </div>
        ) : usableProjects?.length === 0 ? (
          <div className="discover-state">
            <strong>No projects with iteration data were found.</strong>
            <small>Create an Iteration field in GitHub Projects, then try again.</small>
            <button className="secondary-action" onClick={onDiscover}>Try again</button>
          </div>
        ) : (
          <form
            className="setup-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (project && iteration) onSave(project, iteration.id);
            }}
          >
            <label>
              Project
              <select
                onChange={(event) => setProjectId(event.target.value)}
                value={project?.id ?? ""}
              >
                {usableProjects?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.owner} / {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Iteration
              <select
                disabled={!project?.iterations.length}
                onChange={(event) => setIterationId(event.target.value)}
                value={iteration?.id ?? ""}
              >
                {project?.iterations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} · {item.startDate}{item.completed ? " · completed" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="setup-note">
              <span>Read-only</span>
              Synchronization imports project state, comments, reviews, and blockers. It cannot edit GitHub.
            </div>
            <div className="dialog-actions">
              <button className="secondary-action" onClick={onDiscover} type="button">Refresh list</button>
              <button className="primary-action" disabled={!iteration || saving} type="submit">
                {saving ? "Saving…" : "Use this iteration"}
              </button>
            </div>
          </form>
        )}

        {error && <div className="setup-error" role="alert">{error}</div>}
      </section>
    </div>
  );
}

function App() {
  const [snapshots, setSnapshots] = useState({
    baseline: mondaySnapshot,
    current: currentSnapshot,
  });
  const [dataSource, setDataSource] = useState<"loading" | "ledger" | "fixture">(
    "loading",
  );
  const [events, setEvents] = useState(demoActivityEvents);
  const [syncMetrics, setSyncMetrics] = useState(demoSyncMetrics);
  const [qualityMetrics, setQualityMetrics] = useState(demoQualityMetrics);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [projects, setProjects] = useState<GitHubProjectOption[] | null>(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [setupSaving, setSetupSaving] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<{
    status: "idle" | "running" | "updated" | "unchanged" | "error";
    message: string | null;
  }>({ status: "idle", message: null });
  const baseline = snapshots.baseline;
  const current = snapshots.current;
  const analysis = useMemo(
    () => analyzeSprint(baseline, current),
    [baseline, current],
  );
  const [question, setQuestion] = useState(suggestedQuestions[0]);
  const [askedQuestion, setAskedQuestion] = useState(suggestedQuestions[0]);

  useEffect(() => {
    const controller = new AbortController();
    loadDashboard(controller.signal)
      .then((payload) => {
        setSnapshots({ baseline: payload.baseline, current: payload.current });
        setEvents(payload.events);
        if (payload.syncMetrics) setSyncMetrics(payload.syncMetrics);
        setQualityMetrics(payload.qualityMetrics);
        setDataSource("ledger");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDataSource("fixture");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    loadConnections()
      .then((connections) => {
        setConnection(connections[0] ?? null);
        if (connections.length === 0) setSetupOpen(true);
      })
      .catch(() => {
        // The fixture dashboard remains usable when the local API is offline.
      });
  }, []);

  const answer = useMemo(
    () => answerSprintQuestion(askedQuestion, analysis, events),
    [askedQuestion, analysis, events],
  );

  const changeFeed = useMemo(() => {
    const exactChanges = activityEventsToChanges(events);
    const exactCommentItems = new Set(
      exactChanges
        .filter((change) => change.kind === "comments")
        .map((change) => change.itemId),
    );
    return [
      ...analysis.changes.filter(
        (change) =>
          change.kind !== "comments" || !exactCommentItems.has(change.itemId),
      ),
      ...exactChanges,
    ].sort(
      (a, b) =>
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );
  }, [analysis, events]);

  const answerEvidence = useMemo(
    () => evidenceForSprintQuestion(askedQuestion, analysis, events),
    [askedQuestion, analysis, events],
  );

  const progress = Math.round(
    (analysis.completedPoints / analysis.totalPoints) * 100,
  );

  function ask(value = question) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setQuestion(trimmed);
    setAskedQuestion(trimmed);
  }

  async function refreshDashboard() {
    const payload = await loadDashboard();
    setSnapshots({ baseline: payload.baseline, current: payload.current });
    setEvents(payload.events);
    if (payload.syncMetrics) setSyncMetrics(payload.syncMetrics);
    setQualityMetrics(payload.qualityMetrics);
    setDataSource("ledger");
  }

  async function discover() {
    setDiscoveryLoading(true);
    setSetupError(null);
    try {
      setProjects(await discoverProjects());
    } catch (error) {
      const authHelp = error instanceof ApiError && error.kind === "authentication"
        ? " Run `gh auth refresh -s read:project` and try again."
        : "";
      setSetupError(`${error instanceof Error ? error.message : "GitHub discovery failed."}${authHelp}`);
    } finally {
      setDiscoveryLoading(false);
    }
  }

  async function saveConnection(project: GitHubProjectOption, iterationId: string) {
    const iteration = project.iterations.find((item) => item.id === iterationId);
    if (!iteration) return;
    setSetupSaving(true);
    setSetupError(null);
    try {
      const saved = await saveGitHubConnection({
        owner: project.owner,
        projectNumber: project.number,
        projectTitle: project.title,
        projectUrl: project.url,
        iterationId: iteration.id,
        iterationTitle: iteration.title,
      });
      setConnection(saved);
      setSetupOpen(false);
      setSyncState({ status: "idle", message: "Connection saved. Sync when ready." });
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "Could not save the connection.");
    } finally {
      setSetupSaving(false);
    }
  }

  async function runSync() {
    if (!connection) {
      setSetupOpen(true);
      return;
    }
    if (syncState.status === "running") return;

    setSyncState({ status: "running", message: "Reading the selected GitHub iteration…" });
    try {
      const result = await syncConnection(connection.id);
      await refreshDashboard();
      setSyncState({
        status: result.status,
        message: result.status === "unchanged"
          ? `No sprint changes found · ${Math.round(result.summary.durationMs)} ms`
          : `${result.snapshotItems} items synchronized · ${Math.round(result.summary.durationMs)} ms`,
      });
    } catch (error) {
      const authHelp = error instanceof ApiError && error.kind === "authentication"
        ? " Refresh GitHub CLI access with `gh auth refresh -s read:project`."
        : "";
      setSyncState({
        status: "error",
        message: `${error instanceof Error ? error.message : "Synchronization failed."}${authHelp}`,
      });
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Logo />
        <nav aria-label="Primary navigation">
          <a className="nav-item active" href="#overview">
            <span>⌁</span> Overview
          </a>
          <a className="nav-item" href="#changes">
            <span>↯</span> Changes <b>{changeFeed.length}</b>
          </a>
          <a className="nav-item" href="#risks">
            <span>△</span> Risks <b>{analysis.risks.length}</b>
          </a>
          <a className="nav-item" href="#brief">
            <span>✦</span> Ask Orbit
          </a>
        </nav>
        <div className="sidebar-foot">
          <span className="connection-dot" />
          <div>
            <strong>{connection?.displayName ?? (dataSource === "ledger" ? "SQLite ledger" : "Demo ledger")}</strong>
            <small>
              {connection
                ? connection.config.iterationTitle
                : dataSource === "loading"
                ? "Loading snapshots…"
                : dataSource === "ledger"
                  ? "2 persisted snapshots"
                  : "API unavailable · fixture fallback"}
            </small>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <span className="eyebrow">{current.sourceName}</span>
            <h1>{current.sprintName}</h1>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button">
              {new Date(baseline.capturedAt).toLocaleDateString("en", { month: "short", day: "numeric" })}
              {" → "}
              {new Date(current.capturedAt).toLocaleDateString("en", { month: "short", day: "numeric" })}
            </button>
            <button className="ghost-button" onClick={() => setSetupOpen(true)}>
              {connection ? "Configure" : "Connect GitHub"}
            </button>
            <button
              className={`sync-button sync-${syncState.status}`}
              disabled={syncState.status === "running"}
              onClick={runSync}
            >
              <span>↻</span>{" "}
              {syncState.status === "running"
                ? "Syncing"
                : connection
                  ? "Sync now"
                  : "Set up sync"}
            </button>
          </div>
        </header>

        <section className="content" id="overview">
          {syncState.message && (
            <div className={`sync-notice notice-${syncState.status}`} role="status">
              <span />
              {syncState.message}
            </div>
          )}
          <div className="hero-grid">
            <section className="brief-card" id="brief">
              <div className="brief-heading">
                <div className="agent-orb">✦</div>
                <div>
                  <span className="eyebrow">SPRINT BRIEF</span>
                  <h2>Here’s what needs your attention.</h2>
                </div>
                <span className="evidence-mode">Evidence mode</span>
              </div>
              <p className="agent-answer">{answer}</p>
              {answerEvidence.length > 0 && (
                <div className="answer-evidence" aria-label="Answer evidence">
                  <span>Sources</span>
                  {answerEvidence.map((evidence) => (
                    <a
                      href={evidence.url}
                      key={evidence.id}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {evidence.label} ↗
                    </a>
                  ))}
                </div>
              )}
              <div className="question-row">
                {suggestedQuestions.map((item) => (
                  <button
                    className={askedQuestion === item ? "question active" : "question"}
                    key={item}
                    onClick={() => ask(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <form
                className="ask-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  ask();
                }}
              >
                <input
                  aria-label="Ask about this sprint"
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Ask about this sprint…"
                  value={question}
                />
                <button aria-label="Ask question" type="submit">→</button>
              </form>
            </section>

            <section className="progress-card">
              <div className="progress-topline">
                <span className="eyebrow">SPRINT PROGRESS</span>
                <span className="trend">+13% since Monday</span>
              </div>
              <div className="progress-number">
                <strong>{progress}%</strong>
                <span>{analysis.completedPoints} of {analysis.totalPoints} points</span>
              </div>
              <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
              <div className="progress-stats">
                <div><strong>{analysis.completedCount}</strong><span>completed</span></div>
                <div><strong>{analysis.activeCount}</strong><span>active</span></div>
                <div><strong>{analysis.addedCount}</strong><span>added</span></div>
              </div>
              <div className="quality-metrics" aria-label="Quality metrics">
                <div>
                  <strong>{Math.round(syncMetrics.durationMs)} ms</strong>
                  <span>sync latency</span>
                </div>
                <div>
                  <strong>{syncMetrics.requestCount}</strong>
                  <span>API requests</span>
                </div>
                <div>
                  <strong>{Math.round(qualityMetrics.factualCorrectness * 100)}%</strong>
                  <span>fact accuracy</span>
                </div>
                <div>
                  <strong>{Math.round(qualityMetrics.citationCoverage * 100)}%</strong>
                  <span>citation coverage</span>
                </div>
              </div>
              <div className="quality-foot">
                <span className={qualityMetrics.passed ? "quality-pass" : "quality-fail"}>
                  {qualityMetrics.passed ? "Quality gate passed" : "Quality gate failed"}
                </span>
                <span>{qualityMetrics.assertions} assertions</span>
              </div>
            </section>
          </div>

          <div className="section-heading" id="risks">
            <div>
              <span className="eyebrow">RISK RADAR</span>
              <h2>Signals worth acting on</h2>
            </div>
            <span className="section-count">{analysis.risks.length} open signals</span>
          </div>
          <div className="risk-grid">
            {analysis.risks.slice(0, 4).map((item) => (
              <RiskCard key={item.id} risk={item} />
            ))}
          </div>

          <div className="lower-grid">
            <section className="panel" id="changes">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">CHANGE FEED</span>
                  <h2>Since Monday, 09:00</h2>
                </div>
                <button className="text-button">View all →</button>
              </div>
              <div className="timeline">
                {changeFeed.slice(0, 6).map((item) => (
                  <a
                    className="timeline-item"
                    href={item.evidenceUrl}
                    key={item.id}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <span className={`timeline-icon kind-${item.kind}`}>
                      {item.kind === "comments"
                        ? "··"
                        : item.kind === "review"
                          ? "✓"
                          : item.kind === "status"
                            ? "↗"
                            : "+"}
                    </span>
                    <span className="timeline-copy">
                      <strong>{item.summary}</strong>
                      <small>{item.kind.replace("_", " ")} · source evidence</small>
                    </span>
                    <time>{new Date(item.occurredAt).toLocaleDateString("en", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</time>
                  </a>
                ))}
              </div>
            </section>

            <section className="panel work-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">CURRENT STATE</span>
                  <h2>Work in motion</h2>
                </div>
                <span className="section-count">{current.items.length} items</span>
              </div>
              <div className="work-list">
                {current.items.map((item) => (
                  <a href={item.url} className="work-item" key={item.id}>
                    <span className={`status-dot status-${item.status}`} />
                    <span className="work-copy">
                      <strong><span>{item.id}</span> {item.title}</strong>
                      <small>{item.assignee ?? "Unassigned"} · {item.estimate} points</small>
                    </span>
                    <span className={`status-label status-${item.status}`}>
                      {statusLabel[item.status]}
                    </span>
                  </a>
                ))}
              </div>
            </section>
          </div>
        </section>
      </main>
      {setupOpen && (
        <SetupDialog
          error={setupError}
          loading={discoveryLoading}
          onClose={() => setSetupOpen(false)}
          onDiscover={discover}
          onSave={saveConnection}
          projects={projects}
          saving={setupSaving}
        />
      )}
    </div>
  );
}

export default App;
