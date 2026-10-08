import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/_lib/auth.js", async (orig) => ({
  ...(await orig<typeof import("../api/_lib/auth.js")>()),
  requireUser: vi.fn(async () => ({ uid: "u1", idToken: "tok", email: "a@b.c" })),
}));
vi.mock("../api/_lib/usage.js", async (orig) => ({
  ...(await orig<typeof import("../api/_lib/usage.js")>()),
  consumeCall: vi.fn(async () => ({ used: 1, limit: 40 })),
}));

import { POST } from "../api/tts";
import { requireUser } from "../api/_lib/auth.js";
import { AuthError } from "../api/_lib/auth.js";
import { consumeCall, UsageError } from "../api/_lib/usage.js";
import { pcmToWav } from "../api/_lib/tts.js";

const SECRET = "AIza-secret-key-value";
const wavB64 = (seconds: number) =>
  pcmToWav(Buffer.alloc(Math.floor(seconds * 48_000))).toString("base64");

const req = (body: unknown) =>
  new Request("http://x/api/tts", {
    method: "POST",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const ok = { phrases: [{ text: "いち", phase: "exercise" }] };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.GEMINI_API_KEY = SECRET;
  delete process.env.GEMINI_TTS_MODEL;
  delete process.env.GEMINI_TTS_VOICE;
  fetchMock = vi.fn(async () =>
    Response.json({ output_audio: { data: wavB64(1) } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("POST /api/tts", () => {
  it("sends model, voice, style and key header to the interactions endpoint", async () => {
    process.env.GEMINI_TTS_MODEL = "test-model";
    process.env.GEMINI_TTS_VOICE = "Zephyr";
    const res = await POST(req({ phrases: [{ text: "休もう", phase: "rest" }] }));
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/v1beta/interactions");
    expect(init.headers["x-goog-api-key"]).toBe(SECRET);
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe("test-model");
    expect(sent.generation_config.speech_config[0].voice).toBe("Zephyr");
    const content = sent.input[0].content[0];
    expect(content.text).toBe("休もう");
    expect(content.annotations[0].type).toBe("speech_metadata");
    expect(content.annotations[0].style).toContain("落ち着いた");
    const body = (await res.json()) as { profile: string; audio: unknown[] };
    expect(body.profile).toBe("test-model|Zephyr|1");
    expect(body.audio).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("uses different delivery per phase", async () => {
    await POST(req({ phrases: [{ text: "いち", phase: "exercise" }] }));
    await POST(req({ phrases: [{ text: "おつかれ", phase: "closing" }] }));
    const style = (i: number) =>
      JSON.parse(fetchMock.mock.calls[i][1].body).input[0].content[0].annotations[0].style;
    expect(style(0)).toContain("元気");
    expect(style(1)).toContain("あたたか");
  });

  it("requires a signed-in user", async () => {
    vi.mocked(requireUser).mockRejectedValueOnce(new AuthError("ログインが必要です"));
    const res = await POST(req(ok));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["empty list", { phrases: [] }],
    ["too many phrases", { phrases: Array(7).fill(ok.phrases[0]) }],
    ["over the phase limit", { phrases: [{ text: "あ".repeat(81), phase: "exercise" }] }],
    ["unknown phase", { phrases: [{ text: "あ", phase: "x" }] }],
    ["over total chars", { phrases: Array(5).fill({ text: "あ".repeat(100), phase: "rest" }) }],
  ])("rejects %s without spending anything", async (_n, body) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect(consumeCall).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a missing key as not_configured without charging", async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await POST(req(ok));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("not_configured");
    expect(consumeCall).not.toHaveBeenCalled();
  });

  it("draws on its own daily bucket and maps the limit", async () => {
    await POST(req(ok));
    expect(vi.mocked(consumeCall).mock.calls[0][2]).toMatchObject({ bucket: "tts" });
    vi.mocked(consumeCall).mockRejectedValueOnce(new UsageError("上限"));
    expect((await POST(req(ok))).status).toBe(429);
  });

  it("maps upstream failure without leaking the key", async () => {
    fetchMock.mockResolvedValueOnce(new Response(`bad key ${SECRET}`, { status: 400 }));
    const res = await POST(req(ok));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    expect(JSON.parse(text).code).toBe("upstream");
  });

  it("maps a timeout", async () => {
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error(`timeout ${SECRET}`), { name: "TimeoutError" }),
    );
    const res = await POST(req(ok));
    expect(res.status).toBe(504);
    const text = await res.text();
    expect(JSON.parse(text).code).toBe("timeout");
    expect(text).not.toContain(SECRET);
  });

  it("wraps raw PCM and rejects audio longer than allowed", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ output_audio: { data: Buffer.alloc(48_000).toString("base64") } }),
    );
    const res = await POST(req(ok));
    const { audio } = (await res.json()) as { audio: { wav: string }[] };
    expect(Buffer.from(audio[0].wav, "base64").subarray(0, 4).toString()).toBe("RIFF");

    fetchMock.mockResolvedValueOnce(Response.json({ output_audio: { data: wavB64(30) } }));
    expect((await POST(req(ok))).status).toBe(502);
  });

  it("keeps the response under the size budget and reports what it skipped", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ output_audio: { data: wavB64(18) } }),
    );
    const phrases = Array.from({ length: 6 }, (_, i) => ({
      text: `せつめい${i}`,
      phase: "rest",
    }));
    const body = (await (await POST(req({ phrases }))).json()) as {
      audio: unknown[];
      skipped: unknown[];
    };
    expect(body.audio.length).toBeLessThan(6);
    expect(body.audio.length + body.skipped.length).toBe(6);
  });

  it("generates identical lines once", async () => {
    await POST(req({ phrases: [ok.phrases[0], ok.phrases[0]] }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
