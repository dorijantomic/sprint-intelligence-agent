import { useEffect, useMemo, useState } from "react";
import { loadDashboard } from "./api/dashboard";
import {
  currentSnapshot,
  demoActivityEvents,
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

function App() {
  const [snapshots, setSnapshots] = useState({
    baseline: mondaySnapshot,
    current: currentSnapshot,
  });
  const [dataSource, setDataSource] = useState<"loading" | "ledger" | "fixture">(
    "loading",
  );
  const [events, setEvents] = useState(demoActivityEvents);
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
        setDataSource("ledger");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDataSource("fixture");
      });
    return () => controller.abort();
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
            <strong>{dataSource === "ledger" ? "SQLite ledger" : "Demo ledger"}</strong>
            <small>
              {dataSource === "loading"
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
            <button className="sync-button"><span>↻</span> {dataSource === "loading" ? "Loading" : "Synced"}</button>
          </div>
        </header>

        <section className="content" id="overview">
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
    </div>
  );
}

export default App;
