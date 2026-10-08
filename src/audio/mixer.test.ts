// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DUCK_RATIO,
  MUSIC_LEVEL,
  Mixer,
  renderLoop,
  speakDucked,
  type ContextLike,
} from "./mixer";
import { maxSpeechMs, speak } from "../speech/speak";

function fakeContext() {
  const targets: number[] = [];
  const sources: { started: boolean; stopped: boolean; loop: boolean }[] = [];
  const ctx: ContextLike = {
    state: "suspended",
    currentTime: 0,
    sampleRate: 8000,
    destination: {},
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    createGain: () => ({
      gain: { value: 0, setTargetAtTime: (t: number) => void targets.push(t) },
      connect: () => {},
    }),
    createBuffer: () => ({ copyToChannel: () => {} }),
    createBufferSource: () => {
      const s = { buffer: null as unknown, loop: false, started: false, stopped: false,
        connect: () => {}, start() { s.started = true; }, stop() { s.stopped = true; } };
      sources.push(s);
      return s;
    },
  };
  return { ctx, targets, sources };
}

describe("renderLoop", () => {
  it("is audible, bounded and different for work and rest", () => {
    const work = renderLoop("workout", 4000);
    const rest = renderLoop("rest", 4000);
    for (const buf of [work, rest]) {
      expect(buf.length).toBe(32000);
      const peak = Math.max(...buf.map(Math.abs));
      expect(peak).toBeGreaterThan(0.5);
      expect(peak).toBeLessThanOrEqual(0.8001);
    }
    expect(work).not.toEqual(rest);
  });

  it("joins up with itself (no jump at the loop point)", () => {
    const rest = renderLoop("rest", 4000);
    expect(Math.abs(rest[0]! - rest[rest.length - 1]!)).toBeLessThan(0.1);
  });
});

describe("Mixer ducking", () => {
  it("lowers while speaking and returns to the resting level", () => {
    const { ctx, targets } = fakeContext();
    const m = new Mixer(() => ctx);
    m.unlock();
    expect(ctx.resume).toHaveBeenCalled();
    expect(m.level()).toBe(MUSIC_LEVEL);
    m.duck();
    expect(m.level()).toBeCloseTo(MUSIC_LEVEL * DUCK_RATIO);
    m.release();
    expect(m.level()).toBe(MUSIC_LEVEL);
    expect(targets.at(-1)).toBe(MUSIC_LEVEL);
  });

  it("stays low until every overlapping speaker is done, and never goes negative", () => {
    const m = new Mixer(() => fakeContext().ctx);
    m.unlock();
    m.duck();
    m.duck();
    m.release();
    expect(m.ducked).toBe(true);
    m.release();
    m.release();
    expect(m.ducked).toBe(false);
  });

  it("is silent and plays nothing when music is off", () => {
    const { ctx, sources } = fakeContext();
    const m = new Mixer(() => ctx);
    m.unlock();
    m.setEnabled(false);
    m.play("workout");
    expect(m.level()).toBe(0);
    expect(sources).toHaveLength(0);
  });

  it("loops a generated track and replaces it when the phase changes", () => {
    const { ctx, sources } = fakeContext();
    const m = new Mixer(() => ctx);
    m.unlock();
    m.play("workout");
    m.play("rest");
    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({ started: true, stopped: true, loop: true });
    m.stop();
    expect(sources[1]!.stopped).toBe(true);
  });

  it("survives a browser with no WebAudio", () => {
    const m = new Mixer(() => {
      throw new Error("no audio");
    });
    expect(() => {
      m.unlock();
      m.play("workout");
      m.duck();
      m.release();
    }).not.toThrow();
  });
});

describe("speakDucked", () => {
  it("ducks for the length of the speech and releases exactly once", () => {
    const mixer = { duck: vi.fn(), release: vi.fn() };
    let end: (() => void) | undefined;
    const fake = vi.fn((_t: string, o: { onEnd?: () => void } = {}) => {
      end = o.onEnd;
      return { cancel() {} };
    }) as unknown as typeof speak;
    speakDucked(mixer, "いくよ", {}, fake);
    expect(mixer.duck).toHaveBeenCalledTimes(1);
    expect(mixer.release).not.toHaveBeenCalled();
    end!();
    end!();
    expect(mixer.release).toHaveBeenCalledTimes(1);
  });

  it("releases at once when speech is unavailable", () => {
    const mixer = { duck: vi.fn(), release: vi.fn() };
    speakDucked(mixer, "いくよ");
    expect(mixer.release).toHaveBeenCalledTimes(1);
  });
});

describe("speak completion", () => {
  type Utt = { onstart?: () => void; onend?: () => void; onerror?: () => void; rate: number };
  let spoken: Utt[];

  beforeEach(() => {
    vi.useFakeTimers();
    spoken = [];
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        text: string;
        rate = 1; pitch = 1; lang = ""; voice = null;
        constructor(text: string) {
          this.text = text;
        }
      },
    );
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speak: (u: Utt) => void spoken.push(u),
        cancel: () => {},
        getVoices: () => [],
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    // @ts-expect-error test cleanup
    delete window.speechSynthesis;
  });

  it("reports start and a single end", () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    speak("はじめます", { onStart, onEnd });
    spoken[0]!.onstart!();
    spoken[0]!.onend!();
    spoken[0]!.onerror!();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("ends on error too", () => {
    const onEnd = vi.fn();
    speak("はじめます", { onEnd });
    spoken[0]!.onerror!();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("ends when cancelled, once", () => {
    const onEnd = vi.fn();
    const h = speak("はじめます", { onEnd });
    h.cancel();
    h.cancel();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("still returns the music when the browser never fires end", () => {
    const mixer = new Mixer(() => fakeContext().ctx);
    mixer.unlock();
    speakDucked(mixer, "今日もいい調子です。あと3回いきましょう。");
    expect(mixer.ducked).toBe(true);
    vi.advanceTimersByTime(maxSpeechMs("今日もいい調子です。あと3回いきましょう。", 0.98) + 1);
    expect(mixer.ducked).toBe(false);
  });
});
