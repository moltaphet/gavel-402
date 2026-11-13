"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { SCENARIOS, finalVerdict, type PhaseId, type Scenario, type Step } from "@/lib/scenarios";
import { useProceedings, useReducedMotion } from "@/lib/proceedings";

const CourtCanvas = dynamic(() => import("./court/CourtCanvas"), {
  ssr: false,
  loading: () => <div className="loading">Opening the courtroom…</div>,
});

const CONTRACT = "0x50503801Bd1300d1bE52bA6440Aa89E0F993EBcD";
const EXPLORER = "https://explorer-studio-next.genlayer.com";

const PHASE_LABEL: Record<PhaseId, string> = {
  request: "Request",
  verified: "Verified",
  delivered: "Delivered",
  serv: "SERV weighs",
  verdict: "First pass",
  appeal: "Appeal",
  court: "Validators",
  ruling: "Ruling",
  settlement: "Settlement",
};

const word = (v: "ACCEPT" | "REJECT") => (v === "ACCEPT" ? "Accepted" : "Rejected");

function Docket({ current, onSelect }: { current: string; onSelect: (id: string) => void }) {
  return (
    <nav className="docket" aria-label="Cases">
      <h2>Docket</h2>
      <ol>
        {SCENARIOS.map((s) => {
          const paid = finalVerdict(s) === "ACCEPT";
          return (
            <li key={s.id}>
              <button type="button" aria-pressed={s.id === current} onClick={() => onSelect(s.id)}>
                <span className="docket-title">{s.title}</span>
                <span className="docket-blurb">{s.blurb}</span>
                <span className={`docket-result ${paid ? "paid" : "unpaid"}`}>{paid ? "Seller paid" : "Not paid"}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function CaseFile({ scenario, steps, stepIndex }: { scenario: Scenario; steps: Step[]; stepIndex: number }) {
  const has = (p: PhaseId) => {
    const i = steps.findIndex((s) => s.phase === p);
    return i >= 0 && stepIndex >= i;
  };
  const final = finalVerdict(scenario);
  const settled = has("settlement");
  const payment = !has("verified")
    ? "Authorization not signed yet"
    : !settled
      ? "Held in escrow"
      : final === "ACCEPT"
        ? "Released to the seller"
        : "Never left the buyer's wallet";

  return (
    <section className="casefile" aria-live="polite" aria-label="Case file">
      <h2>{scenario.title}</h2>

      <h3>Promised</h3>
      <p className="quote">{scenario.spec}</p>

      <h3>Delivered</h3>
      {has("delivered") ? (
        <p className="quote mono">{scenario.deliverable}</p>
      ) : (
        <p className="pending">Not delivered yet.</p>
      )}

      <h3>First pass</h3>
      {has("verdict") ? (
        <>
          <p className={`stamp ${scenario.serv.verdict === "ACCEPT" ? "ok" : "no"}`}>{word(scenario.serv.verdict)}</p>
          <p className="reason">
            {scenario.serv.supplied
              ? "Verdict supplied by the test to force an appeal. SERV did not produce it."
              : scenario.serv.reason}
          </p>
        </>
      ) : (
        <p className="pending">{has("serv") ? "SERV Reasoning is reading the delivery…" : "Waiting for the delivery."}</p>
      )}

      {scenario.appeal && (
        <>
          <h3>Appeal by the {scenario.appeal.by}</h3>
          {has("ruling") ? (
            <>
              <p className={`stamp ${scenario.appeal.verdict === "ACCEPT" ? "ok" : "no"}`}>{word(scenario.appeal.verdict)}</p>
              <p className="reason">{scenario.appeal.reason}</p>
            </>
          ) : (
            <p className="pending">{has("court") ? "Validators are deliberating…" : has("appeal") ? "Appeal filed." : "No appeal yet."}</p>
          )}
        </>
      )}

      <h3>Payment</h3>
      <p className={settled ? (final === "ACCEPT" ? "pay ok" : "pay no") : "pay"}>{payment}</p>

      <details className="provenance">
        <summary>Where this came from</summary>
        <ul className="sources">
          {scenario.sources.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function RealPanel({ onClose }: { onClose: () => void }) {
  return (
    <aside className="real" role="dialog" aria-label="What is real in this demo">
      <h2>What is real here</h2>
      <h3>Real</h3>
      <ul>
        <li>The SERV Reasoning verdicts and reasons come from live calls we made on 2026-11-13.</li>
        <li>
          The court rulings come from live validator consensus on GenLayer studio-next. Contract{" "}
          <a href={EXPLORER} target="_blank" rel="noreferrer">
            {CONTRACT.slice(0, 8)}…{CONTRACT.slice(-6)}
          </a>
          .
        </li>
        <li>The gateway and the contract are real code with passing tests.</li>
      </ul>
      <h3>Simulated or illustrative</h3>
      <ul>
        <li>No payment moves. We had no pieUSD, so the gateway has never settled a real Kite payment.</li>
        <li>Cases marked as supplied use a first-pass verdict chosen to force an appeal.</li>
        <li>The five validator seats are illustrative, and waits are shortened.</li>
        <li>Reasons ending in an ellipsis were cut when recorded.</li>
      </ul>
      <button type="button" className="btn" onClick={onClose}>
        Close
      </button>
    </aside>
  );
}

export default function Dashboard() {
  const p = useProceedings("garbage");
  const reduced = useReducedMotion();
  const [follow, setFollow] = useState(true);
  const [showReal, setShowReal] = useState(false);
  const step = p.steps[p.stepIndex]!;

  return (
    <main className="stage">
      <div className="canvas">
        <CourtCanvas live={p.live} follow={follow} reduced={reduced} />
      </div>

      <header className="brand">
        <h1>Gavel</h1>
        <p>Agents pay only for proof.</p>
      </header>

      <div className="chips">
        <span className="chip sim">Payment simulated</span>
        <button type="button" className="chip btn-chip" onClick={() => setShowReal((v) => !v)} aria-expanded={showReal}>
          What is real?
        </button>
      </div>

      <Docket current={p.scenario.id} onSelect={p.selectScenario} />
      <CaseFile scenario={p.scenario} steps={p.steps} stepIndex={p.stepIndex} />
      {showReal && <RealPanel onClose={() => setShowReal(false)} />}

      <footer className="proceedings">
        <div className="now" aria-live="polite">
          <h2>{step.title}</h2>
          <p>{step.detail}</p>
        </div>
        <ol className="steps">
          {p.steps.map((s, i) => (
            <li key={`${s.phase}:${i}`}>
              <button
                type="button"
                className={i < p.stepIndex || (p.finished && i === p.stepIndex) ? "done" : i === p.stepIndex ? "active" : ""}
                onClick={() => p.seek(i)}
                aria-current={i === p.stepIndex ? "step" : undefined}
              >
                {PHASE_LABEL[s.phase]}
              </button>
            </li>
          ))}
        </ol>
        <div className="controls">
          <button type="button" className="btn" onClick={p.togglePlay} disabled={p.finished}>
            {p.playing ? "Pause" : "Resume"}
          </button>
          <button type="button" className="btn" onClick={p.replay}>
            Replay case
          </button>
          <button type="button" className="btn" onClick={() => setFollow((f) => !f)} aria-pressed={!follow}>
            {follow ? "Explore the room" : "Follow the action"}
          </button>
        </div>
      </footer>
    </main>
  );
}
