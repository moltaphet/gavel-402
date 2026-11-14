import { bad, LIMITS, liveEnabled } from "@/lib/server/gate";
import { judgeWithServ } from "@/lib/server/serv";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!liveEnabled()) return bad(403, "live_disabled");
  let body: { spec?: unknown; deliverable?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad(400, "invalid_json");
  }
  const spec = typeof body.spec === "string" ? body.spec.trim() : "";
  const deliverable = typeof body.deliverable === "string" ? body.deliverable : "";
  if (!spec || spec.length > LIMITS.spec) return bad(400, "spec_missing_or_too_long");
  if (deliverable.length > LIMITS.deliverable) return bad(400, "deliverable_too_long");
  try {
    return Response.json(await judgeWithServ(spec, deliverable));
  } catch (e) {
    return bad(502, e instanceof Error ? e.message : "judge_failed");
  }
}
