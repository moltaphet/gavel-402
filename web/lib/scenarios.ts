/**
 * Recorded cases. The verdict and reason strings are copied from real runs made on 2026-11-13:
 *  - SERV Reasoning judge: live calls through gateway/src/judge.ts (reasons shortened with an ellipsis where
 *    the capture was cut).
 *  - GenLayer court: live runs of the calibration set on studio-next, contract
 *    0x50503801Bd1300d1bE52bA6440Aa89E0F993EBcD.
 * Where a first-pass verdict was supplied by the test (to force an appeal), the case says so.
 * Payment is always simulated in this dashboard: no funds move.
 */

export type Verdict = "ACCEPT" | "REJECT";

export type PhaseId =
  | "request"
  | "verified"
  | "delivered"
  | "serv"
  | "verdict"
  | "appeal"
  | "court"
  | "ruling"
  | "settlement";

export interface Scenario {
  id: string;
  title: string;
  blurb: string;
  spec: string;
  deliverable: string;
  serv: {
    verdict: Verdict;
    reason: string;
    /** True when the test supplied this verdict instead of a real SERV call. */
    supplied: boolean;
  };
  appeal?: {
    by: "buyer" | "seller";
    verdict: Verdict;
    reason: string;
  };
  sources: string[];
}

const SPEC_JSON =
  "Return a JSON list of exactly 3 sources about Kite AI, each with a url and a one-sentence summary.";
const SPEC_TEXT = "Return exactly 3 sources about Kite AI, each with a url and a one-sentence summary.";

export const SCENARIOS: Scenario[] = [
  {
    id: "garbage",
    title: "Filler instead of work",
    blurb: "The seller returns nonsense. The payment never moves.",
    spec: SPEC_JSON,
    deliverable: "lorem ipsum dolor sit amet",
    serv: {
      verdict: "REJECT",
      reason: "The deliverable is unrelated placeholder text and does not provide the required JSON list…",
      supplied: false,
    },
    sources: [
      "First-pass verdict and reason: recorded from a live SERV Reasoning call (reason shortened).",
      "Payment: simulated. No funds moved.",
    ],
  },
  {
    id: "good",
    title: "Good work, paid at once",
    blurb: "A correct delivery is accepted and the payment settles.",
    spec: SPEC_JSON,
    deliverable:
      '[{"url":"https://docs.gokite.ai","summary":"Kite docs"},{"url":"https://gokite.ai","summary":"Kite home"},{"url":"https://x.com/GoKiteAI","summary":"Kite on X"}]',
    serv: {
      verdict: "ACCEPT",
      reason: "The deliverable is a JSON list of exactly 3 sources about Kite AI, and each entry includes…",
      supplied: false,
    },
    sources: [
      "First-pass verdict and reason: recorded from a live SERV Reasoning call (reason shortened).",
      "Payment: simulated. No funds moved.",
    ],
  },
  {
    id: "buyer-appeal",
    title: "Buyer overturns a bad acceptance",
    blurb: "The fast judge is fooled. The buyer appeals and the court rules.",
    spec: SPEC_TEXT,
    deliverable: "lorem ipsum dolor sit amet",
    serv: { verdict: "ACCEPT", reason: "", supplied: true },
    appeal: {
      by: "buyer",
      verdict: "REJECT",
      reason: "The deliverable is placeholder text and does not contain any of the required sources about Kite AI.",
    },
    sources: [
      "First-pass verdict: supplied by the test to force an appeal. It is not a SERV output.",
      "Court ruling and reason: recorded from a live run on GenLayer studio-next (calibration case r1).",
      "Payment: simulated. No funds moved.",
    ],
  },
  {
    id: "seller-appeal",
    title: "Seller overturns a wrong rejection",
    blurb: "Good work is rejected. The seller appeals and the court pays out.",
    spec: SPEC_TEXT,
    deliverable:
      "1. https://docs.gokite.ai - Official Kite AI documentation. 2. https://gokite.ai - The Kite AI website. 3. https://faucet.gokite.ai - Testnet token faucet for Kite AI.",
    serv: { verdict: "REJECT", reason: "", supplied: true },
    appeal: {
      by: "seller",
      verdict: "ACCEPT",
      reason:
        "The deliverable provides exactly three distinct URLs related to Kite AI, and each is accompanied by a concise, one-sentence description.",
    },
    sources: [
      "First-pass verdict: supplied by the test to force an appeal. It is not a SERV output.",
      "Court ruling and reason: recorded from a live run on GenLayer studio-next (calibration case a2).",
      "Payment: simulated. No funds moved.",
    ],
  },
];

export function finalVerdict(s: Scenario): Verdict {
  return s.appeal ? s.appeal.verdict : s.serv.verdict;
}

export interface Step {
  phase: PhaseId;
  title: string;
  detail: string;
  ms: number;
}

const word = (v: Verdict) => (v === "ACCEPT" ? "accepted" : "rejected");

export function buildSteps(s: Scenario): Step[] {
  const steps: Step[] = [
    {
      phase: "request",
      title: "The agent calls the paid API",
      detail: "It signs a payment authorization for the seller's price.",
      ms: 2200,
    },
    {
      phase: "verified",
      title: "Payment verified, nothing moves",
      detail: "The authorization is checked and held. The buyer's funds stay in the buyer's wallet.",
      ms: 2600,
    },
    {
      phase: "delivered",
      title: "The seller delivers the work",
      detail: "The response is held back. The buyer cannot see it yet.",
      ms: 2400,
    },
    {
      phase: "serv",
      title: "SERV Reasoning weighs it against the spec",
      detail: "The fast judge compares what was promised with what arrived.",
      ms: 3200,
    },
    {
      phase: "verdict",
      title: `First pass: ${word(s.serv.verdict)}`,
      detail: s.serv.supplied
        ? "Verdict supplied by the test to force an appeal."
        : s.serv.reason,
      ms: 3000,
    },
  ];
  if (s.appeal) {
    steps.push(
      {
        phase: "appeal",
        title: `The ${s.appeal.by} appeals`,
        detail:
          s.appeal.by === "buyer"
            ? "The buyer disputes an acceptance that is still inside the appeal window."
            : "The seller disputes a rejection.",
        ms: 2400,
      },
      {
        phase: "court",
        title: "Validators deliberate on GenLayer",
        detail: "Independent validators each judge the case. Consensus decides. Live rulings took 23 to 43 seconds.",
        ms: 5200,
      },
      {
        phase: "ruling",
        title: `Court rules: ${word(s.appeal.verdict)}`,
        detail: s.appeal.reason,
        ms: 3200,
      },
    );
  }
  const final = finalVerdict(s);
  steps.push(
    final === "ACCEPT"
      ? {
          phase: "settlement",
          title: "Payment released to the seller",
          detail: "Only now does the held authorization settle, and the deliverable goes to the buyer.",
          ms: 3600,
        }
      : {
          phase: "settlement",
          title: "The payment never leaves the buyer",
          detail: "Nothing settles. The deliverable stays withheld.",
          ms: 3600,
        },
  );
  return steps;
}
