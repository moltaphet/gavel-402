"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SCENARIOS, buildSteps, finalVerdict, type PhaseId, type Scenario, type Step, type Verdict } from "./scenarios";

/** Mutable, per-frame state read by the 3D scene without re-rendering React. */
export interface Live {
  scenario: Scenario;
  steps: Step[];
  /** Index of the first step of each phase (absent phases are undefined). */
  idx: Partial<Record<PhaseId, number>>;
  cur: number;
  /** Progress inside the current step, 0..1. */
  t: number;
  /** Seconds the proceedings have run (pauses excluded). Drives idle wobble. */
  clock: number;
  playing: boolean;
  finished: boolean;
}

export function makeLive(scenario: Scenario): Live {
  const steps = buildSteps(scenario);
  const idx: Live["idx"] = {};
  steps.forEach((s, i) => {
    if (idx[s.phase] === undefined) idx[s.phase] = i;
  });
  return { scenario, steps, idx, cur: 0, t: 0, clock: 0, playing: true, finished: false };
}

export const reached = (L: Live, p: PhaseId): boolean => L.idx[p] !== undefined && L.cur >= (L.idx[p] as number);
export const inStep = (L: Live, p: PhaseId): boolean => L.idx[p] === L.cur;

/** The most recent verdict known at this point of the proceedings, if any. */
export function verdictNow(L: Live): Verdict | null {
  if (reached(L, "ruling") && L.scenario.appeal) return L.scenario.appeal.verdict;
  if (reached(L, "verdict")) return L.scenario.serv.verdict;
  return null;
}

export { finalVerdict };

export function useProceedings(initialId: string) {
  const [scenarioId, setScenarioId] = useState(initialId);
  // A live run from the "try it" panel replaces the recorded case until the user picks another one.
  const [custom, setCustom] = useState<Scenario | null>(null);
  const scenario = useMemo(
    () => custom ?? SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0]!,
    [custom, scenarioId],
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [finished, setFinished] = useState(false);

  const live = useRef<Live>(makeLive(scenario));
  const elapsed = useRef(0);

  // New scenario: reset everything.
  useEffect(() => {
    live.current = makeLive(scenario);
    elapsed.current = 0;
    setStepIndex(0);
    setFinished(false);
    setPlaying(true);
  }, [scenario]);

  useEffect(() => {
    live.current.playing = playing;
  }, [playing]);

  // One clock for everything: advances steps and feeds the 3D scene.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const L = live.current;
      if (L.playing && !L.finished) {
        elapsed.current += dt * 1000;
        L.clock += dt;
      }
      let acc = 0;
      let cur = L.steps.length - 1;
      let t = 1;
      let done = true;
      for (let i = 0; i < L.steps.length; i++) {
        const end = acc + L.steps[i]!.ms;
        if (elapsed.current < end) {
          cur = i;
          t = (elapsed.current - acc) / L.steps[i]!.ms;
          done = false;
          break;
        }
        acc = end;
      }
      if (cur !== L.cur) setStepIndex(cur);
      if (done !== L.finished) setFinished(done);
      L.cur = cur;
      L.t = t;
      L.finished = done;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const seek = useCallback((i: number) => {
    const L = live.current;
    let acc = 0;
    for (let k = 0; k < Math.min(i, L.steps.length); k++) acc += L.steps[k]!.ms;
    elapsed.current = acc;
    setPlaying(true);
  }, []);

  const replay = useCallback(() => {
    elapsed.current = 0;
    live.current.finished = false;
    live.current.clock = 0;
    setFinished(false);
    setPlaying(true);
  }, []);

  return {
    scenario,
    steps: live.current.steps,
    stepIndex,
    playing,
    finished,
    live,
    selectScenario: (id: string) => {
      setCustom(null);
      setScenarioId(id);
    },
    playCustom: (next: Scenario) => setCustom(next),
    togglePlay: () => setPlaying((p) => !p),
    seek,
    replay,
  };
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(q.matches);
    update();
    q.addEventListener("change", update);
    return () => q.removeEventListener("change", update);
  }, []);
  return reduced;
}
