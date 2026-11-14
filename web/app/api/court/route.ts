import { bad, liveEnabled } from "@/lib/server/gate";
import { courtRule } from "@/lib/server/court";
import type { Verdict } from "@/lib/scenarios";

export const runtime = "nodejs";
// A court run takes about 25 to 45 seconds on live consensus.
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!liveEnabled()) return bad(403, "live_disabled");
  let body: { spec?: unknown; deliverable?: unknown; firstVerdict?: unknown; firstReason?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad(400, "invalid_json");
  }
  const spec = typeof body.spec === "string" ? body.spec.trim() : "";
  const deliverable = typeof body.deliverable === "string" ? body.deliverable : "";
  const firstVerdict = body.firstVerdict === "ACCEPT" || body.firstVerdict === "REJECT" ? (body.firstVerdict as Verdict) : null;
  const firstReason = typeof body.firstReason === "string" ? body.firstReason.slice(0, 500) : "";
  if (!spec || !firstVerdict) return bad(400, "spec_and_first_verdict_required");
  // One case per request so repeated clicks never open a duplicate.
  const caseId = `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    return Response.json({ caseId, ...(await courtRule(caseId, spec, deliverable, firstVerdict, firstReason)) });
  } catch (e) {
    return bad(502, e instanceof Error ? e.message : "court_failed");
  }
}
