/** Live calls cost money and write to a chain, so they run only when explicitly enabled. */
export function liveEnabled(): boolean {
  return process.env.LIVE_ENABLED === "1";
}

export const LIMITS = { spec: 1000, deliverable: 4000 } as const;

export function bad(status: number, error: string) {
  return Response.json({ error }, { status });
}
