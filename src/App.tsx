import { useEffect, useMemo, useState } from "react";
import {
  askSprintAgent,
  type AgentAnswer,
} from "./api/agent";
import {
  loadAgentConfig,
  saveAgentConfig,
  testAgentConfig,
  type AgentConfig,
  type AgentConfigInput,
  type AgentProvider,
} from "./api/agentConfig";
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

interface AgentSettingsDialogProps {
  config: AgentConfig | null;
  loading: boolean;
  loadError: string | null;
  onClose: () => void;
  onSaved: (config: AgentConfig) => void;
}

function AgentSettingsDialog({
  config,
  loading,
  loadError,
  onClose,
  onSaved,
}: AgentSettingsDialogProps) {
  const [provider, setProvider] = useState<AgentProvider>(
    config?.provider ?? "deterministic",
  );
  const [model, setModel] = useState(config?.model ?? "");
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? "");
  const [runtimeModule, setRuntimeModule] = useState(
    config?.runtimeModule ?? "",
  );
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!config) return;
    setProvider(config.provider);
    setModel(config.model ?? "");
    setBaseUrl(config.baseUrl ?? "");
    setRuntimeModule(config.runtimeModule ?? "");
  }, [config]);

  function selectProvider(next: AgentProvider) {
    setProvider(next);
    setMessage(null);
    if (next === "openai" && !model) setModel("gpt-5.6");
    if (next === "openai-compatible" && !baseUrl) {
      setBaseUrl("http://127.0.0.1:11434/v1");
    }
  }

  async function saveAndTest() {
    if (!config?.editable) return;
    setSaving(true);
    setMessage(null);
    const input: AgentConfigInput = {
      provider,
      model: model || null,
      baseUrl: baseUrl || null,
      runtimeModule: runtimeModule || null,
      clearApiKey,
      ...(apiKey ? { apiKey } : {}),
    };
    try {
      const saved = await saveAgentConfig(input);
      onSaved(saved);
      setApiKey("");
      setClearApiKey(false);
      const result = await testAgentConfig();
      setMessage({
        kind: "success",
        text: result.provider === "deterministic"
          ? "Saved. Orbit will use its deterministic evidence engine."
          : `Connected to ${result.provider} · ${result.model ?? "custom agent"} in ${Math.round(result.durationMs)} ms.`,
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not configure the agent.",
      });
    } finally {
      setSaving(false);
    }
  }

  const showConnectionFields = provider !== "deterministic";
  const hasStoredKeyForSelection =
    config?.hasApiKey === true && provider === config.provider;

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="agent-settings-title"
        aria-modal="true"
        className="setup-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">AGENT RUNTIME</span>
            <h2 id="agent-settings-title">Choose your AI provider</h2>
          </div>
          <button aria-label="Close agent settings" className="dialog-close" onClick={onClose}>×</button>
        </div>
        <p className="dialog-copy">
          Orbit owns tool execution and evidence validation. The selected agent only chooses read tools and proposes cited claims.
        </p>

        {loading ? (
          <div className="discover-state"><strong>Loading agent settings…</strong></div>
        ) : loadError ? (
          <div className="setup-error" role="alert">{loadError}</div>
        ) : config ? (
          <form
            className="setup-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveAndTest();
            }}
          >
            <label>
              Provider
              <select
                disabled={!config.editable}
                onChange={(event) => selectProvider(event.target.value as AgentProvider)}
                value={provider}
              >
                <option value="deterministic">Deterministic · no external AI</option>
                <option value="openai">OpenAI Responses</option>
                <option value="openai-compatible">OpenAI-compatible endpoint</option>
                <option value="custom">Custom agent runtime module</option>
              </select>
            </label>

            {showConnectionFields && (
              <>
                <label>
                  Model or agent name
                  <input
                    disabled={!config.editable}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder={provider === "custom" ? "Optional agent label" : "Tool-capable model name"}
                    value={model}
                  />
                </label>
                {provider === "openai-compatible" && (
                  <label>
                    Base URL
                    <input
                      disabled={!config.editable}
                      onChange={(event) => setBaseUrl(event.target.value)}
                      placeholder="http://127.0.0.1:11434/v1"
                      value={baseUrl}
                    />
                  </label>
                )}
                {provider === "custom" && (
                  <label>
                    Runtime module path
                    <input
                      disabled={!config.editable}
                      onChange={(event) => setRuntimeModule(event.target.value)}
                      placeholder="./server/agent/runtime/my-agent.ts"
                      value={runtimeModule}
                    />
                  </label>
                )}
                <label>
                  API key {provider !== "openai" && <span className="optional-label">optional</span>}
                  <input
                    autoComplete="new-password"
                    disabled={!config.editable || clearApiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={hasStoredKeyForSelection ? "Saved key · leave blank to keep" : "Key stays on this machine"}
                    type="password"
                    value={apiKey}
                  />
                </label>
              </>
            )}

            {hasStoredKeyForSelection && (
              <label className="checkbox-label">
                <input
                  checked={clearApiKey}
                  disabled={!config.editable}
                  onChange={(event) => setClearApiKey(event.target.checked)}
                  type="checkbox"
                />
                Remove the saved API key from this machine
              </label>
            )}

            <div className="setup-note">
              <span>{config.source === "environment" ? "Environment" : "Local only"}</span>
              {config.source === "environment"
                ? "These settings are controlled by environment variables and cannot be changed here."
                : "Secrets are stored outside Git in .data/agent-config.json with owner-only file permissions."}
            </div>
            {message && (
              <div className={message.kind === "success" ? "setup-success" : "setup-error"} role="status">
                {message.text}
              </div>
            )}
            <div className="dialog-actions">
              <button className="secondary-action" onClick={onClose} type="button">Close</button>
              {config.editable && (
                <button className="primary-action" disabled={saving} type="submit">
                  {saving ? "Saving and testing…" : "Save and test"}
                </button>
              )}
            </div>
          </form>
        ) : null}
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
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [agentConfigLoading, setAgentConfigLoading] = useState(false);
  const [agentConfigError, setAgentConfigError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<{
    status: "idle" | "running" | "updated" | "unchanged" | "error";
    message: string | null;
  }>({ status: "idle", message: null });
  const [agentResult, setAgentResult] = useState<AgentAnswer | null>(null);
  const [agentState, setAgentState] = useState<{
    status: "idle" | "loading" | "error";
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

  async function openAgentSettings() {
    setAgentSettingsOpen(true);
    setAgentConfigLoading(true);
    setAgentConfigError(null);
    try {
      setAgentConfig(await loadAgentConfig());
    } catch (error) {
      setAgentConfigError(
        error instanceof Error ? error.message : "Could not load agent settings.",
      );
    } finally {
      setAgentConfigLoading(false);
    }
  }

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

  const deterministicAnswer = useMemo(
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

  const deterministicEvidence = useMemo(
    () => evidenceForSprintQuestion(askedQuestion, analysis, events),
    [askedQuestion, analysis, events],
  );
  const displayedAnswer =
    agentState.status === "loading"
      ? "Consulting the sprint ledger and checking evidence…"
      : agentResult?.answer ?? deterministicAnswer;
  const displayedEvidence = agentResult?.evidence ?? deterministicEvidence;

  const progress = Math.round(
    (analysis.completedPoints / analysis.totalPoints) * 100,
  );

  async function ask(value = question) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setQuestion(trimmed);
    setAskedQuestion(trimmed);
    setAgentResult(null);
    setAgentState({ status: "loading", message: null });
    try {
      setAgentResult(await askSprintAgent(trimmed));
      setAgentState({ status: "idle", message: null });
    } catch (error) {
      setAgentState({
        status: "error",
        message: `${error instanceof Error ? error.message : "The agent is unavailable."} Showing the verified local analysis instead.`,
      });
    }
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
            <button className="ghost-button" onClick={() => void openAgentSettings()}>
              AI provider
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
              <p className="agent-answer">{displayedAnswer}</p>
              {displayedEvidence.length > 0 && agentState.status !== "loading" && (
                <div className="answer-evidence" aria-label="Answer evidence">
                  <span>Sources</span>
                  {displayedEvidence.map((evidence) => (
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
              {agentResult && (
                <div className="agent-trace" aria-label="Agent execution trace">
                  <span>
                    {agentResult.mode === "agent"
                      ? `${agentResult.provider ?? "custom"} · ${agentResult.model}`
                      : agentResult.fallbackReason === "agent_not_configured"
                        ? "Rules-only · no agent configured"
                        : "Rules-only · agent fallback"}
                  </span>
                  <span>{agentResult.toolsUsed.length} ledger tool{agentResult.toolsUsed.length === 1 ? "" : "s"}</span>
                  <span>{agentResult.claims.length} cited claim{agentResult.claims.length === 1 ? "" : "s"}</span>
                  <span>{Math.round(agentResult.telemetry.durationMs)} ms</span>
                </div>
              )}
              {agentState.status === "error" && (
                <div className="agent-error" role="alert">{agentState.message}</div>
              )}
              <div className="question-row">
                {suggestedQuestions.map((item) => (
                  <button
                    className={askedQuestion === item ? "question active" : "question"}
                    key={item}
                    onClick={() => void ask(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <form
                className="ask-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void ask();
                }}
              >
                <input
                  aria-label="Ask about this sprint"
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Ask about this sprint…"
                  value={question}
                />
                <button
                  aria-label="Ask question"
                  disabled={agentState.status === "loading"}
                  type="submit"
                >
                  {agentState.status === "loading" ? "…" : "→"}
                </button>
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
      {agentSettingsOpen && (
        <AgentSettingsDialog
          config={agentConfig}
          loadError={agentConfigError}
          loading={agentConfigLoading}
          onClose={() => setAgentSettingsOpen(false)}
          onSaved={setAgentConfig}
        />
      )}
    </div>
  );
}

export default App;
