import { describe, expect, it, vi } from "vitest";
import { createTeacher, type AudioContextLike } from "./teacher";
import { createTtsStore, hashKey } from "./ttsStore";
import type { TtsResponse } from "../../shared/tts";

const PROFILE = "m|v|1";
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

class FakeSource {
  buffer: unknown;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  connect() {}
  start() { this.started = true; }
  stop() { this.stopped = true; this.onended?.(); }
}

function setup(
  opts: { state?: string; generate?: ReturnType<typeof vi.fn>; fetchProfile?: ReturnType<typeof vi.fn> } = {},
) {
  const sources: FakeSource[] = [];
  const ctx: AudioContextLike = {
    currentTime: 0,
    state: opts.state ?? "running",
    destination: {},
    resume: async () => {},
    decodeAudioData: async () => ({ duration: 1 }),
    createBufferSource: () => {
      const s = new FakeSource();
      sources.push(s);
      return s;
    },
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
  };
  const store = createTtsStore({ storage: mem() });
  store.setProfile(PROFILE);
  const spoken: string[] = [];
  const fallbackEnds: (() => void)[] = [];
  let clock = 0;
  const timers: { fn: () => void; at: number }[] = [];
  const generate = opts.generate ?? vi.fn();
  const teacher = createTeacher({
    store,
    audioContext: () => ctx,
    generate: generate as never,
    fetchProfile: opts.fetchProfile as never,
    fallback: (text, onEnd) => {
      spoken.push(text);
      fallbackEnds.push(onEnd);
      return { cancel: vi.fn() };
    },
    now: () => clock,
    setTimer: (fn, ms) => { timers.push({ fn, at: clock + ms }); return timers.length - 1; },
    clearTimer: (id) => { if (timers[id as number]) timers[id as number].fn = () => {}; },
  });
  const events: boolean[] = [];
  teacher.onSpeakingChange((s) => events.push(s));
  const cache = (text: string, phase: "exercise" | "rest" | "closing" = "exercise") =>
    store.put(hashKey(PROFILE, phase, text), new ArrayBuffer(8), false);
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { teacher, sources, spoken, fallbackEnds, events, cache, flush, generate, store,
    advance: (ms: number) => { clock += ms; for (const t of timers.splice(0)) if (t.at <= clock) t.fn(); } };
}

describe("playback", () => {
  it("plays cached audio and falls back to the device voice on a miss", async () => {
    const t = setup();
    await t.cache("いち");
    t.teacher.say({ text: "いち", phase: "exercise", kind: "count" });
    await t.flush();
    expect(t.sources[0].started).toBe(true);
    t.sources[0].onended!();
    t.teacher.say({ text: "未生成", phase: "exercise" });
    await t.flush();
    expect(t.spoken).toEqual(["未生成"]);
  });

  it("falls back when the audio context was never unlocked", async () => {
    const t = setup({ state: "suspended" });
    await t.cache("いち");
    t.teacher.say({ text: "いち", phase: "exercise" });
    await t.flush();
    expect(t.sources).toHaveLength(0);
    expect(t.spoken).toEqual(["いち"]);
  });

  it("does not use Gemini audio when switched off", async () => {
    const t = setup();
    await t.cache("いち");
    t.teacher.setGeminiEnabled(false);
    t.teacher.say({ text: "いち", phase: "exercise" });
    await t.flush();
    expect(t.sources).toHaveLength(0);
    expect(t.spoken).toEqual(["いち"]);
  });

  it("queues non-count cues in order", async () => {
    const t = setup();
    await t.cache("a"); await t.cache("b");
    t.teacher.say({ text: "a", phase: "exercise" });
    t.teacher.say({ text: "b", phase: "exercise" });
    await t.flush();
    expect(t.sources).toHaveLength(1);
    t.sources[0].onended!();
    await t.flush();
    expect(t.sources).toHaveLength(2);
  });

  it("lets the latest count cut the old one and drop queued counts", async () => {
    const t = setup();
    for (const x of ["1", "2", "3"]) await t.cache(x);
    t.teacher.say({ text: "1", phase: "exercise", kind: "count" });
    await t.flush();
    t.teacher.say({ text: "2", phase: "exercise", kind: "count" });
    t.teacher.say({ text: "3", phase: "exercise", kind: "count" });
    await t.flush();
    expect(t.sources[0].stopped).toBe(true);
    // "2" was superseded before it ever started.
    expect(t.sources).toHaveLength(2);
    expect(t.sources[1].started).toBe(true);
  });

  it("does not interrupt the closing line with a count", async () => {
    const t = setup();
    await t.cache("おわり", "closing"); await t.cache("1");
    t.teacher.say({ text: "おわり", phase: "closing" });
    await t.flush();
    t.teacher.say({ text: "1", phase: "exercise", kind: "count" });
    await t.flush();
    expect(t.sources[0].stopped).toBe(false);
  });

  it("discards a cue that waited past its deadline", async () => {
    const t = setup();
    await t.cache("a"); await t.cache("b");
    t.teacher.say({ text: "a", phase: "exercise" });
    t.teacher.say({ text: "b", phase: "exercise", expiresMs: 1000 });
    await t.flush();
    t.advance(5000);
    t.sources[0].onended!();
    await t.flush();
    expect(t.sources).toHaveLength(1);
    expect(t.spoken).toEqual([]);
    expect(t.teacher.isSpeaking()).toBe(false);
  });

  it("truncates audio that would run into the next cue", async () => {
    const t = setup();
    await t.cache("長い");
    t.teacher.say({ text: "長い", phase: "exercise", maxMs: 400 });
    await t.flush();
    t.advance(400);
    expect(t.sources[0].stopped).toBe(true);
    expect(t.teacher.isSpeaking()).toBe(false);
  });

  it("pause drops queued and playing speech and ignores late decodes", async () => {
    const t = setup();
    await t.cache("a"); await t.cache("b");
    t.teacher.say({ text: "a", phase: "exercise" });
    t.teacher.say({ text: "b", phase: "exercise" });
    await t.flush();
    t.teacher.pause();
    await t.flush();
    expect(t.sources[0].stopped).toBe(true);
    expect(t.sources).toHaveLength(1);
    expect(t.teacher.isSpeaking()).toBe(false);

    // A cue requested in the same tick as the stop but before decoding ends.
    t.teacher.say({ text: "b", phase: "exercise" });
    t.teacher.stop();
    await t.flush();
    expect(t.sources).toHaveLength(1);
  });

  it("cancelling a handle removes a queued cue", async () => {
    const t = setup();
    await t.cache("a"); await t.cache("b");
    t.teacher.say({ text: "a", phase: "exercise" });
    const h = t.teacher.say({ text: "b", phase: "exercise" });
    h.cancel();
    await t.flush();
    t.sources[0].onended!();
    await t.flush();
    expect(t.sources).toHaveLength(1);
  });
});

describe("speaking notifications", () => {
  it("fires on edges only and survives duplicate end events", async () => {
    const t = setup();
    await t.cache("a"); await t.cache("b");
    t.teacher.say({ text: "a", phase: "exercise" });
    t.teacher.say({ text: "b", phase: "exercise" });
    await t.flush();
    t.sources[0].onended!();
    t.sources[0].onended!(); // duplicate
    await t.flush();
    expect(t.events).toEqual([true]);
    t.sources[1].onended!();
    t.sources[1].onended!();
    expect(t.events).toEqual([true, false]);
  });

  it("reports the fallback voice too, once", async () => {
    const t = setup();
    t.teacher.say({ text: "x", phase: "exercise" });
    await t.flush();
    expect(t.events).toEqual([true]);
    t.fallbackEnds[0](); t.fallbackEnds[0]();
    expect(t.events).toEqual([true, false]);
  });
});

describe("prefetch", () => {
  const response = (texts: string[]): TtsResponse => ({
    profile: PROFILE,
    audio: texts.map((text) => ({ text, phase: "exercise", wav: btoa("RIFFxxxx") })),
    skipped: [],
  });

  it("chunks requests, caches results and skips what is already cached", async () => {
    const generate = vi.fn(async (phrases: { text: string }[]) => response(phrases.map((p) => p.text)));
    const t = setup({ generate });
    const phrases = Array.from({ length: 8 }, (_, i) => ({ text: `n${i}`, phase: "exercise" as const }));
    await t.cache("n0");
    const r = await t.teacher.prefetch(phrases);
    expect(generate).toHaveBeenCalledTimes(2); // 7 missing -> 6 + 1
    expect(r).toEqual({ cached: 8, failed: 0 });
    await t.teacher.prefetch(phrases);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("never throws and stops asking after a not_configured answer", async () => {
    const generate = vi.fn(async () => {
      throw Object.assign(new Error("no key"), { code: "not_configured" });
    });
    const t = setup({ generate });
    const many = Array.from({ length: 13 }, (_, i) => ({ text: `n${i}`, phase: "exercise" as const }));
    const r = await t.teacher.prefetch(many);
    expect(r.failed).toBe(13);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("falls back at playback when generation failed", async () => {
    const t = setup({ generate: vi.fn(async () => { throw new Error("boom"); }) });
    await t.teacher.prefetch([{ text: "いち", phase: "exercise" }]);
    t.teacher.say({ text: "いち", phase: "exercise" });
    await t.flush();
    expect(t.spoken).toEqual(["いち"]);
  });

  it("does not store audio that arrives after an abort", async () => {
    const controller = new AbortController();
    const generate = vi.fn(async () => { controller.abort(); return response(["x"]); });
    const t = setup({ generate });
    const r = await t.teacher.prefetch([{ text: "x", phase: "exercise" }], controller.signal);
    expect(r.failed).toBe(1);
  });

  it("keeps personal audio out of the persistent index", async () => {
    const generate = vi.fn(async () => ({
      profile: PROFILE,
      audio: [{ text: "あなたへ", phase: "closing" as const, wav: btoa("RIFFxxxx") }],
      skipped: [],
    }));
    const t = setup({ generate });
    await t.teacher.prefetch([{ text: "あなたへ", phase: "closing", personal: true }]);
    t.teacher.say({ text: "あなたへ", phase: "closing" });
    await t.flush();
    expect(t.sources[0]?.started).toBe(true);
  });
});

describe("interrupt", () => {
  it("drops queued and playing scene lines but keeps closing words", async () => {
    const t = setup();
    for (const x of ["rest", "next", "bye"]) await t.cache(x, x === "bye" ? "closing" : "rest");
    t.teacher.say({ text: "rest", phase: "rest" });
    await t.flush();
    t.teacher.say({ text: "next", phase: "rest" });
    t.teacher.say({ text: "bye", phase: "closing" });
    t.teacher.interrupt();
    await t.flush();
    expect(t.sources[0].stopped).toBe(true);
    // "next" never started; the closing line took over.
    expect(t.sources).toHaveLength(2);
    expect(t.sources[1].stopped).toBe(false);
  });

  it("leaves a playing closing line alone", async () => {
    const t = setup();
    await t.cache("bye", "closing");
    t.teacher.say({ text: "bye", phase: "closing" });
    await t.flush();
    t.teacher.interrupt();
    expect(t.sources[0].stopped).toBe(false);
  });

  it("does not let a line still being decoded start after the interrupt", async () => {
    const t = setup();
    await t.cache("rest", "rest");
    t.teacher.say({ text: "rest", phase: "rest" });
    t.teacher.interrupt();
    await t.flush();
    expect(t.sources).toHaveLength(0);
    // The next scene's cue is not held back by the dropped one.
    await t.cache("go");
    t.teacher.say({ text: "go", phase: "exercise" });
    await t.flush();
    expect(t.sources).toHaveLength(1);
    expect(t.events.at(-1)).toBe(true);
  });
});

describe("voice profile", () => {
  it("speaks on the device until the profile is confirmed, then uses the cache", async () => {
    let resolve!: (p: string) => void;
    const fetchProfile = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const t = setup({ fetchProfile });
    await t.cache("いち");
    t.teacher.say({ text: "いち", phase: "exercise" });
    await t.flush();
    expect(t.spoken).toEqual(["いち"]);
    expect(t.sources).toHaveLength(0);
    resolve(PROFILE);
    await t.teacher.refreshProfile();
    t.fallbackEnds[0]();
    t.teacher.say({ text: "いち", phase: "exercise" });
    await t.flush();
    expect(t.sources).toHaveLength(1);
    expect(fetchProfile).toHaveBeenCalledTimes(1);
  });

  it("retires audio cached under a profile the server no longer uses", async () => {
    const t = setup({ fetchProfile: vi.fn(async () => "new|voice|2") });
    await t.cache("いち");
    await t.teacher.refreshProfile();
    t.teacher.say({ text: "いち", phase: "exercise" });
    await t.flush();
    expect(t.sources).toHaveLength(0);
    expect(t.spoken).toEqual(["いち"]);
  });

  it("keeps the stored profile when the check fails", async () => {
    const t = setup({ fetchProfile: vi.fn(async () => { throw new Error("offline"); }) });
    await t.cache("いち");
    await t.teacher.refreshProfile();
    t.teacher.say({ text: "いち", phase: "exercise" });
    await t.flush();
    expect(t.sources).toHaveLength(1);
  });

  it("prefetch waits for the confirmation before looking at the cache", async () => {
    const generate = vi.fn(async () => ({ profile: "new|voice|2", audio: [], skipped: [] }));
    const t = setup({ generate, fetchProfile: vi.fn(async () => "new|voice|2") });
    await t.cache("いち");
    const res = await t.teacher.prefetch([{ text: "いち", phase: "exercise" }]);
    // The old entry does not count under the new profile, so it is requested.
    expect(generate).toHaveBeenCalledTimes(1);
    expect(res.cached).toBe(0);
  });
});

describe("quota", () => {
  it("stops asking once the daily limit is reported", async () => {
    const generate = vi.fn(async () => {
      throw Object.assign(new Error("limit"), { code: "limit" });
    });
    const t = setup({ generate });
    const first = await t.teacher.prefetch([{ text: "a", phase: "exercise" }]);
    const second = await t.teacher.prefetch([{ text: "b", phase: "exercise" }]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(first.failed).toBe(1);
    expect(second.failed).toBe(1);
    // Playback is unaffected: the device voice takes over.
    t.teacher.say({ text: "b", phase: "exercise" });
    await t.flush();
    expect(t.spoken).toEqual(["b"]);
  });
});
