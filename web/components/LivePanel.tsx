"use client";

import { useEffect, useState } from "react";
import type { Scenario, Verdict } from "@/lib/scenarios";

interface Props {
  /** The case currently on screen: its spec and deliverable are the starting point. */
  base: Scenario;
  /** Replays the courtroom with a live result. */
  onPlay: (s: Scenario) => void;
  onClose: () => void;
}

type Phase = "idle" | "judging" | "judged" | "court" | "done" | "error";

const word = (v: Verdict) => (v === "ACCEPT" ? "Accepted" : "Rejected");

export function LivePanel({ base, onPlay, onClose }: Props) {
  const [spec, setSpec] = useState(base.spec);
  const [deliverable, setDeliverable] = useState(base.deliverable);
  const [phase, setPhase] = useState<Phase>("idle");
  const [first, setFirst] = useState<{ verdict: Verdict; reason: string } | null>(null);
  const [court, setCourt] = useState<{ verdict: Verdict; reason: string; txHashes: string[] } | null>(null);
  const [error, setError] = useState("");
  const [started, setStarted] = useState(0);
  const [now, setNow] = useState(0);

  // Tick once a second while the court is deliberating, so the elapsed time moves.
  useEffect(() => {
    if (phase !== "court") return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  const disabled = phase === "judging" || phase === "court";
  const specOk = spec.trim().length > 0 && spec.length <= 1000;
  const delOk = deliverable.length <= 4000;

  async function judge() {
    setError("");
    setCourt(null);
    setPhase("judging");
    try {
      const res = await fetch("/api/judge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spec, deliverable }),
      });
      const data = (await res.json()) as { verdict?: Verdict; reason?: string; model?: string; error?: string };
      if (!res.ok || !data.verdict) throw new Error(explain(data.error));
      setFirst({ verdict: data.verdict, reason: data.reason ?? "" });
      setPhase("judged");
      onPlay({
        id: "live",
        title: "Your live test",
        blurb: "",
        spec,
        deliverable,
        serv: { verdict: data.verdict, reason: data.reason ?? "", supplied: false },
        sources: [
          `First pass: live SERV Reasoning call, model ${data.model ?? "unknown"}.`,
          "Payment: simulated. No funds moved.",
        ],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("error");
    }
  }

  async function sendToCourt() {
    if (!first) return;
    setError("");
    setPhase("court");
    setStarted(Date.now());
    try {
      const res = await fetch("/api/court", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spec, deliverable, firstVerdict: first.verdict, firstReason: first.reason }),
      });
      const data = (await res.json()) as { verdict?: Verdict; reason?: string; txHashes?: string[]; error?: string };
      if (!res.ok || !data.verdict) throw new Error(explain(data.error));
      const result = { verdict: data.verdict, reason: data.reason ?? "", txHashes: data.txHashes ?? [] };
      setCourt(result);
      setPhase("done");
      // The first pass is the side that disputes it: a rejection is appealed by the seller, an acceptance by the buyer.
      onPlay({
        id: "live",
        title: "Your live test, appealed",
        blurb: "",
        spec,
        deliverable,
        serv: { verdict: first.verdict, reason: first.reason, supplied: false },
        appeal: { by: first.verdict === "REJECT" ? "seller" : "buyer", verdict: result.verdict, reason: result.reason },
        sources: [
          "First pass: live SERV Reasoning call.",
          `Court: live GenLayer consensus on studio-dev. Transactions: ${result.txHashes.join(", ")}`,
          "Payment: simulated. No funds moved.",
        ],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("judged");
    }
  }

  return (
    <aside className="real live" role="dialog" aria-label="Try it live">
      <h2>Try it live</h2>
      <p className="live-note">Runs a real SERV Reasoning call. The court writes to the GenLayer studio-dev test network and takes about 30 to 45 seconds.</p>

      <label className="field">
        <span>Spec</span>
        <textarea value={spec} onChange={(e) => setSpec(e.target.value)} rows={2} disabled={disabled} />
      </label>
      <label className="field">
        <span>Delivery ({deliverable.length}/4000)</span>
        <textarea value={deliverable} onChange={(e) => setDeliverable(e.target.value)} rows={5} disabled={disabled} />
      </label>

      <div className="live-actions">
        <button type="button" className="btn" onClick={judge} disabled={disabled || !specOk || !delOk}>
          {phase === "judging" ? "Judging…" : "Judge with SERV"}
        </button>
        <button type="button" className="btn" onClick={sendToCourt} disabled={disabled || !first}>
          {phase === "court" ? "Validators deliberating…" : "Send to the court"}
        </button>
      </div>

      {first && (
        <div className="live-result">
          <h3>First pass</h3>
          <p className={`stamp ${first.verdict === "ACCEPT" ? "ok" : "no"}`}>{word(first.verdict)}</p>
          <p className="reason">{first.reason}</p>
        </div>
      )}

      {phase === "court" && (
        <p className="live-wait" aria-live="polite">
          Waiting for validator consensus. {Math.max(0, Math.round((now - started) / 1000))} s so far.
        </p>
      )}

      {court && (
        <div className="live-result">
          <h3>Court</h3>
          <p className={`stamp ${court.verdict === "ACCEPT" ? "ok" : "no"}`}>{word(court.verdict)}</p>
          <p className="reason">{court.reason}</p>
          <ul className="sources">
            {court.txHashes.map((h) => (
              <li key={h}>
                <a href={`https://explorer-studio-dev.genlayer.com/tx/${h}`} target="_blank" rel="noreferrer">
                  {h.slice(0, 10)}…{h.slice(-6)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="live-error" role="alert">{error}</p>}

      <div className="live-foot">
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </aside>
  );
}

function explain(code: string | undefined): string {
  switch (code) {
    case "live_disabled":
      return "Live mode is off on this server (LIVE_ENABLED is not set).";
    case "spec_missing_or_too_long":
      return "The spec is empty or longer than 1000 characters.";
    case "deliverable_too_long":
      return "The delivery is longer than 4000 characters.";
    default:
      return code ? `The live call failed: ${code}` : "The live call failed.";
  }
}
