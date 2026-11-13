import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { JudgeError, ServJudge, buildUserPrompt, parseVerdict, MAX_DELIVERABLE_CHARS } from "../src/judge.js";
import { priceToUnits, KITE_NETWORKS } from "../src/networks.js";

describe("parseVerdict", () => {
  it("parses plain JSON", () => {
    expect(parseVerdict('{"verdict":"ACCEPT","reason":"ok"}')).toEqual({ verdict: "ACCEPT", reason: "ok" });
  });
  it("strips code fences and wrapping text", () => {
    const r = parseVerdict('Sure!\n```json\n{"verdict":"reject","reason":"empty"}\n```');
    expect(r).toEqual({ verdict: "REJECT", reason: "empty" });
  });
  it("aliases keys and verdict words", () => {
    expect(parseVerdict('{"decision":"approved","explanation":"fine"}')).toEqual({ verdict: "ACCEPT", reason: "fine" });
    expect(parseVerdict('{"result":"FAIL"}').verdict).toBe("REJECT");
  });
  it("throws on garbage so callers fail closed", () => {
    expect(() => parseVerdict("no json here")).toThrow(JudgeError);
    expect(() => parseVerdict('{"verdict":"banana"}')).toThrow(JudgeError);
    expect(() => parseVerdict('{"reason":"x"}')).toThrow(JudgeError);
    expect(() => parseVerdict("{not json}")).toThrow(JudgeError);
  });
});

describe("buildUserPrompt", () => {
  it("wraps untrusted parts in delimiters and truncates huge deliverables", () => {
    const p = buildUserPrompt({
      spec: "spec",
      request: { method: "GET", url: "/v1/x" },
      deliverable: "A".repeat(MAX_DELIVERABLE_CHARS + 50),
    });
    expect(p).toContain("<SPEC>");
    expect(p).toContain("<DELIVERABLE truncated_to=");
    expect(p.length).toBeLessThan(MAX_DELIVERABLE_CHARS + 500);
  });
});

describe("ServJudge", () => {
  const input = { spec: "s", request: { method: "GET", url: "/v1/x" }, deliverable: "d" };
  const make = (fetchImpl: unknown) =>
    new ServJudge({
      apiKey: "k",
      baseUrl: "https://serv.example/v1",
      model: "m",
      timeoutMs: 1000,
      fetchImpl: fetchImpl as typeof fetch,
    });

  it("sends a system message and bearer auth, and returns the verdict", async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '{"verdict":"ACCEPT","reason":"ok"}' } }] }), {
          status: 200,
        }),
    );
    const out = await make(f).judge(input);
    expect(out.verdict).toBe("ACCEPT");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://serv.example/v1/chat/completions");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer k");
    const sent = JSON.parse(init.body as string);
    expect(sent.messages[0].role).toBe("system");
    expect(sent.model).toBe("m");
  });

  it("throws JudgeError on HTTP errors, empty content and network failure", async () => {
    await expect(make(async () => new Response("no", { status: 500 })).judge(input)).rejects.toThrow(JudgeError);
    await expect(
      make(async () => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }))).judge(input),
    ).rejects.toThrow(JudgeError);
    await expect(
      make(async () => {
        throw new Error("down");
      }).judge(input),
    ).rejects.toThrow(JudgeError);
  });

  it("never leaks the API key in errors", async () => {
    const err = await make(async () => {
      throw new Error("boom with k");
    })
      .judge(input)
      .catch((e: Error) => e);
    expect(String(err)).not.toContain("boom with k");
  });
});

describe("config and pricing", () => {
  const base = { PAY_TO: "0x" + "11".repeat(20), UPSTREAM_URL: "https://s.example", SERV_API_KEY: "k" };
  it("applies defaults (testnet, 0.001, port 8402)", () => {
    const c = loadConfig(base);
    expect(c.network.network).toBe("eip155:2368");
    expect(c.priceUsd).toBe("0.001");
    expect(c.port).toBe(8402);
  });
  it("rejects missing or malformed required values", () => {
    expect(() => loadConfig({ ...base, PAY_TO: undefined })).toThrow(/PAY_TO/);
    expect(() => loadConfig({ ...base, PAY_TO: "0x123" })).toThrow(/PAY_TO/);
    expect(() => loadConfig({ ...base, UPSTREAM_URL: "ftp://x" })).toThrow(/UPSTREAM_URL/);
    expect(() => loadConfig({ ...base, SERV_API_KEY: undefined })).toThrow(/SERV_API_KEY/);
    expect(() => loadConfig({ ...base, KITE_NETWORK: "ethereum" })).toThrow(/KITE_NETWORK/);
    expect(() => loadConfig({ ...base, UPSTREAM_AUTH_HEADER: "x-key" })).toThrow(/together/);
  });
  it("converts prices to atomic units per network", () => {
    expect(priceToUnits("0.001", KITE_NETWORKS.testnet)).toBe("1000000000000000");
    expect(priceToUnits("$1", KITE_NETWORKS.mainnet)).toBe("1000000");
    expect(() => priceToUnits("0", KITE_NETWORKS.testnet)).toThrow();
    expect(() => priceToUnits("1.1234567", KITE_NETWORKS.testnet)).toThrow();
    expect(() => priceToUnits("abc", KITE_NETWORKS.testnet)).toThrow();
  });
});
