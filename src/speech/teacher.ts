// The workout teacher's voice: Gemini audio from the cache when it is
// there, the device voice when it is not.
//
// Playback never waits on a request. Reusable lines are prefetched before
// the workout and personal ones ahead of the moment they are needed; at
// `say()` time the cache either has the audio (played through a shared
// AudioContext) or the line goes straight to Web Speech. Voices may mix in
// that case, which beats a silent beat or a late count.
//
// Overlap rules: a count cuts whatever is playing (a stale "7" is worse
// than silence) and drops queued counts; everything else queues, and a line
// whose moment has passed is discarded instead of read late. stop()/pause()
// bump an epoch, so audio decoded after the stop is thrown away.

import {
  TTS_MAX_CHARS,
  TTS_MAX_PHRASES,
  TTS_MAX_TOTAL_CHARS,
  type TtsErrorCode,
  type TtsPhase,
  type TtsPhrase,
  type TtsResponse,
} from "../../shared/tts";
import { hashKey, type TtsStore } from "./ttsStore";
import type { SpeechHandle } from "./speak";

export type Cue = {
  text: string;
  phase: TtsPhase;
  /** "count" interrupts; "closing" is never interrupted or expired. */
  kind?: "count" | "cue" | "closing";
  /** Drop the line if it has waited this long. */
  expiresMs?: number;
  /** Cut the audio off after this long so it cannot run into the next cue. */
  maxMs?: number;
};

export type Prefetchable = TtsPhrase & { personal?: boolean };

type SourceLike = {
  buffer: unknown;
  onended: (() => void) | null;
  connect(node: unknown): void;
  start(when?: number): void;
  stop(when?: number): void;
};
export type AudioContextLike = {
  readonly currentTime: number;
  readonly state?: string;
  readonly destination: unknown;
  resume(): Promise<void>;
  decodeAudioData(data: ArrayBuffer): Promise<{ duration: number }>;
  createBufferSource(): SourceLike;
  createGain(): { gain: { value: number }; connect(node: unknown): void };
};

export type TeacherDeps = {
  store: TtsStore;
  audioContext: () => AudioContextLike | undefined;
  generate: (phrases: TtsPhrase[], signal?: AbortSignal) => Promise<TtsResponse>;
  /** Device voice, used whenever Gemini audio is not ready. */
  fallback: (text: string, onEnd: () => void) => SpeechHandle;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  maxDecoded?: number;
};

const DEFAULT_EXPIRES: Record<NonNullable<Cue["kind"]>, number> = {
  count: 1500,
  cue: 8000,
  closing: Infinity,
};

const b64ToBuffer = (b64: string): ArrayBuffer => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

type Item = {
  cue: Cue;
  kind: NonNullable<Cue["kind"]>;
  queuedAt: number;
  done: boolean;
  stop?: () => void;
};

export function createTeacher(deps: TeacherDeps) {
  const { store } = deps;
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id as never));
  const maxDecoded = deps.maxDecoded ?? 40;

  let ctx: AudioContextLike | undefined;
  let gain: ReturnType<AudioContextLike["createGain"]> | undefined;
  let epoch = 0;
  let queue: Item[] = [];
  let current: Item | null = null;
  let speaking = false;
  let geminiOn = true;
  let unavailable = false;
  const listeners = new Set<(speaking: boolean) => void>();
  const decoded = new Map<string, { duration: number }>();
  const inflight = new Map<string, Promise<void>>();

  const context = () => {
    if (!ctx) {
      ctx = deps.audioContext();
      if (ctx) {
        gain = ctx.createGain();
        gain.gain.value = 1;
        gain.connect(ctx.destination);
      }
    }
    return ctx;
  };

  const notify = () => {
    const now = current !== null;
    if (now === speaking) return;
    speaking = now;
    for (const l of [...listeners]) l(speaking);
  };

  const keyFor = (cue: Pick<Cue, "text" | "phase">) => {
    const profile = store.profile();
    return profile ? hashKey(profile, cue.phase, cue.text) : undefined;
  };

  function finish(item: Item) {
    if (item.done) return; // duplicate end notifications are ignored
    item.done = true;
    if (current === item) current = null;
    // Start the next line before reporting idle, so back-to-back cues do
    // not flicker the music back up between them.
    pump();
    notify();
  }

  async function play(item: Item) {
    const mine = epoch;
    current = item;
    notify();
    item.stop = () => finish(item);
    const stale = () => item.done || mine !== epoch;

    const speakOnDevice = () => {
      if (stale()) return;
      const handle = deps.fallback(item.cue.text, () => finish(item));
      item.stop = () => {
        handle.cancel();
        finish(item);
      };
    };

    const key = geminiOn && !unavailable ? keyFor(item.cue) : undefined;
    const audio = context();
    // A context that never got its user-gesture resume() would hold the
    // source forever and no end would fire; the device voice is the way out.
    if (!key || !audio || audio.state === "suspended") return speakOnDevice();

    let buffer: { duration: number } | undefined;
    try {
      buffer = decoded.get(key);
      if (!buffer) {
        const bytes = await store.get(key);
        if (stale()) return;
        if (!bytes) return speakOnDevice();
        buffer = await audio.decodeAudioData(bytes.slice(0));
        decoded.set(key, buffer);
        if (decoded.size > maxDecoded) decoded.delete(decoded.keys().next().value!);
      }
    } catch {
      return speakOnDevice();
    }
    if (stale()) return;

    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    let timer: unknown;
    source.onended = () => {
      if (timer !== undefined) clearTimer(timer);
      finish(item);
    };
    item.stop = () => {
      source.onended = null;
      if (timer !== undefined) clearTimer(timer);
      try {
        source.stop();
      } catch {
        /* never started */
      }
      finish(item);
    };
    source.start();
    const limit = item.cue.maxMs;
    if (limit !== undefined && buffer.duration * 1000 > limit) {
      timer = setTimer(() => item.stop?.(), limit);
    }
  }

  function pump() {
    while (!current && queue.length) {
      const item = queue.shift()!;
      const expires = item.cue.expiresMs ?? DEFAULT_EXPIRES[item.kind];
      if (now() - item.queuedAt > expires) {
        item.done = true;
        continue;
      }
      void play(item);
    }
  }

  function halt() {
    epoch++;
    const pending = queue;
    queue = [];
    for (const i of pending) i.done = true;
    current?.stop?.();
    if (current) finish(current);
  }

  return {
    /** Call from the Start button's tap: iOS only lets audio begin from a
     *  user gesture. Safe to call repeatedly. */
    async unlock(): Promise<void> {
      try {
        await context()?.resume();
      } catch {
        /* the device voice still works */
      }
    },

    setGeminiEnabled(on: boolean) {
      geminiOn = on;
    },

    /** Music/background volume is the caller's; this is the voice level. */
    setVolume(volume: number) {
      context();
      if (gain) gain.gain.value = Math.min(1, Math.max(0, volume));
    },

    say(cue: Cue): SpeechHandle {
      const kind = cue.kind ?? (cue.phase === "closing" ? "closing" : "cue");
      const item: Item = { cue, kind, queuedAt: now(), done: false };
      if (kind === "count") {
        for (const q of queue.filter((q) => q.kind === "count")) q.done = true;
        queue = queue.filter((q) => q.kind !== "count");
        queue.unshift(item);
        if (current && current.kind !== "closing") current.stop?.();
        else pump();
      } else {
        queue.push(item);
        pump();
      }
      return {
        cancel: () => {
          if (item.done) return;
          if (current === item) item.stop?.();
          else item.done = true;
          queue = queue.filter((q) => q !== item);
        },
      };
    },

    /** Drops everything queued and playing. Anything still being decoded
     *  or fetched is ignored when it arrives. */
    stop: halt,
    cancel: halt,
    pause: halt,

    /** Fires on the idle→speaking and speaking→idle edges only, so a
     *  duplicate end can neither double-duck nor early-restore music. */
    onSpeakingChange(listener: (speaking: boolean) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    isSpeaking: () => speaking,

    /** Generates and caches whatever is missing. Never throws and never
     *  blocks playback; failures just mean those lines use the device voice. */
    async prefetch(
      phrases: Prefetchable[],
      signal?: AbortSignal,
    ): Promise<{ cached: number; failed: number }> {
      const wanted = new Map<string, Prefetchable>();
      for (const p of phrases) wanted.set(`${p.phase}\n${p.text}`, p);

      // A line over its phase limit would be refused by the server; it is
      // simply left to the device voice.
      const tooLong = [...wanted.values()].filter((p) => p.text.length > TTS_MAX_CHARS[p.phase]);
      for (const p of tooLong) wanted.delete(`${p.phase}\n${p.text}`);

      const missing = [...wanted.values()].filter((p) => {
        const key = keyFor(p);
        return !(key && store.has(key));
      });
      let cached = wanted.size - missing.length;
      let failed = tooLong.length;

      const chunks: Prefetchable[][] = [];
      let chunk: Prefetchable[] = [];
      let chars = 0;
      for (const p of missing) {
        if (
          chunk.length >= TTS_MAX_PHRASES ||
          chars + p.text.length > TTS_MAX_TOTAL_CHARS
        ) {
          chunks.push(chunk);
          chunk = [];
          chars = 0;
        }
        chunk.push(p);
        chars += p.text.length;
      }
      if (chunk.length) chunks.push(chunk);

      for (const group of chunks) {
        if (unavailable || signal?.aborted) {
          failed += group.length;
          continue;
        }
        const id = group.map((p) => `${p.phase}\n${p.text}`).join("\u0000");
        let job = inflight.get(id);
        if (!job) {
          job = (async () => {
            const res = await deps.generate(
              group.map(({ text, phase }) => ({ text, phase })),
              signal,
            );
            if (signal?.aborted) throw new Error("aborted");
            store.setProfile(res.profile);
            for (const a of res.audio) {
              const personal = wanted.get(`${a.phase}\n${a.text}`)?.personal ?? false;
              await store.put(
                hashKey(res.profile, a.phase, a.text),
                b64ToBuffer(a.wav),
                !personal,
              );
            }
          })().finally(() => inflight.delete(id));
          inflight.set(id, job);
        }
        try {
          await job;
        } catch (err) {
          const code = (err as { code?: TtsErrorCode }).code;
          // No key, or the daily allowance is spent: asking again this
          // session would only repeat the refusal.
          if (code === "not_configured" || code === "limit") unavailable = true;
        }
        for (const p of group) {
          const key = keyFor(p);
          if (key && store.has(key)) cached++;
          else failed++;
        }
      }
      return { cached, failed };
    },
  };
}

export type Teacher = ReturnType<typeof createTeacher>;
