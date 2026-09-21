import { useMemo, useState } from "react";
import { currentSnapshot, mondaySnapshot } from "./data/demoSprint";
import { analyzeSprint, answerSprintQuestion } from "./domain/analyzeSprint";
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
  const analysis = useMemo(
    () => analyzeSprint(mondaySnapshot, currentSnapshot),
    [],
  );
  const [question, setQuestion] = useState(suggestedQuestions[0]);
  const [answer, setAnswer] = useState(() =>
    answerSprintQuestion(suggestedQuestions[0], analysis),
  );

  const progress = Math.round(
    (analysis.completedPoints / analysis.totalPoints) * 100,
  );

  function ask(value = question) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setQuestion(trimmed);
    setAnswer(answerSprintQuestion(trimmed, analysis));
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
            <span>↯</span> Changes <b>{analysis.changes.length}</b>
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
            <strong>Fixture ledger</strong>
            <small>2 snapshots synced</small>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <span className="eyebrow">ACME / CHECKOUT</span>
            <h1>{currentSnapshot.sprintName}</h1>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button">Sep 14 → Sep 18</button>
            <button className="sync-button"><span>↻</span> Synced just now</button>
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
              <div className="question-row">
                {suggestedQuestions.map((item) => (
                  <button
                    className={question === item ? "question active" : "question"}
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
                {analysis.changes.slice(0, 6).map((item) => (
                  <a
                    className="timeline-item"
                    href={item.evidenceUrl}
                    key={item.id}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <span className={`timeline-icon kind-${item.kind}`}>
                      {item.kind === "comments" ? "··" : item.kind === "status" ? "↗" : "+"}
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
                <span className="section-count">{currentSnapshot.items.length} items</span>
              </div>
              <div className="work-list">
                {currentSnapshot.items.map((item) => (
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
