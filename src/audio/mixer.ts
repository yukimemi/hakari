// Music for a guided session, held under the teacher's voice.
//
// Only audio the app is allowed to play goes through here:
//
//   - loops the app synthesises itself (`renderLoop`) — nothing recorded,
//     nothing licensed, nothing downloaded;
//   - a file the user picked on their own device, played from an object
//     URL that never leaves the browser.
//
// Streaming a catalogue or ripping a track from elsewhere is deliberately
// not a code path. Everything runs through one gain node, which is how the
// music is lowered while the teacher speaks and raised again afterwards.

import { speak } from "../speech/speak";

export type MusicKind = "workout" | "rest";

/** Resting volume of the music relative to full scale. Background, not
 *  foreground. */
export const MUSIC_LEVEL = 0.35;
/** What the music is multiplied by while someone is talking. */
export const DUCK_RATIO = 0.25;

const LOOP_SEC = 8;

/** Mono samples of a loop that joins up with itself. Pure, so the shape
 *  of it can be checked without an audio device. */
export function renderLoop(kind: MusicKind, sampleRate: number): Float32Array {
  const n = Math.round(LOOP_SEC * sampleRate);
  const out = new Float32Array(n);
  const TAU = Math.PI * 2;

  if (kind === "workout") {
    const beats = 16; // 120 bpm over 8 s
    const beatN = n / beats;
    let seed = 12345;
    const noise = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x80000000 - 1;
    };
    for (let i = 0; i < n; i++) {
      const pos = i % beatN;
      const t = pos / sampleRate;
      const beat = Math.floor(i / beatN);
      // Kick on every beat: a sine falling from 120 to 50 Hz.
      const kick =
        Math.sin(TAU * (50 * t + (70 * (1 - Math.exp(-30 * t))) / 30)) *
        Math.exp(-9 * t);
      // Hat on the off-beat.
      const offT = ((i + beatN / 2) % beatN) / sampleRate;
      const hat = noise() * Math.exp(-70 * offT) * 0.25;
      // A bass line of four steps, one bar each, in whole cycles per loop
      // so the join is silent.
      const bassHz = [55, 55, 65.5, 49][Math.floor(beat / 4) % 4]!;
      const bass = Math.sin(TAU * bassHz * (i / sampleRate)) * 0.18;
      out[i] = kick * 0.7 + hat + bass;
    }
  } else {
    // Slow pad: an A-minor chord whose frequencies are whole numbers of
    // cycles per loop, swelling once per loop.
    const freqs = [220, 262, 330];
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      const swell = 0.55 + 0.45 * Math.sin(TAU * (t / LOOP_SEC) - Math.PI / 2);
      let v = 0;
      for (const f of freqs) v += Math.sin(TAU * f * t);
      out[i] = (v / freqs.length) * swell * 0.6;
    }
  }

  // Normalise to a safe peak.
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]!));
  if (peak > 0) for (let i = 0; i < n; i++) out[i] = (out[i]! / peak) * 0.8;
  return out;
}

// The slice of WebAudio this uses, so a test can stand in for it.
export type AudioParamLike = {
  value: number;
  setTargetAtTime: (target: number, start: number, timeConstant: number) => unknown;
};
export type GainLike = { gain: AudioParamLike; connect: (to: unknown) => unknown };
export type SourceLike = {
  buffer: unknown;
  loop: boolean;
  connect: (to: unknown) => unknown;
  start: () => void;
  stop: () => void;
};
export type ContextLike = {
  state: string;
  currentTime: number;
  sampleRate: number;
  destination: unknown;
  resume: () => Promise<unknown>;
  close: () => Promise<unknown>;
  createGain: () => GainLike;
  createBuffer: (channels: number, length: number, rate: number) => {
    copyToChannel: (data: Float32Array, channel: number) => void;
  };
  createBufferSource: () => SourceLike;
  createMediaElementSource?: (el: HTMLAudioElement) => { connect: (to: unknown) => unknown };
};

function defaultContext(): ContextLike {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  return new Ctor() as unknown as ContextLike;
}

export class Mixer {
  private ctx: ContextLike | null = null;
  private master: GainLike | null = null;
  private source: SourceLike | null = null;
  private element: HTMLAudioElement | null = null;
  private fileUrl: string | null = null;
  private ducks = 0;
  private enabled = true;
  private playing: MusicKind | null = null;

  private readonly makeContext: () => ContextLike;
  private readonly makeAudio: (url: string) => HTMLAudioElement;

  constructor(
    makeContext: () => ContextLike = defaultContext,
    makeAudio: (url: string) => HTMLAudioElement = (url) => new Audio(url),
  ) {
    this.makeContext = makeContext;
    this.makeAudio = makeAudio;
  }

  /** Must run inside a user gesture: iOS refuses to start audio any other
   *  way, and a context created later stays suspended for good. */
  unlock(): void {
    try {
      if (!this.ctx) {
        this.ctx = this.makeContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.level();
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
    } catch {
      // No WebAudio: the session carries on without music.
      this.ctx = null;
      this.master = null;
    }
  }

  /** Current target volume, 0..1. */
  level(): number {
    if (!this.enabled) return 0;
    return MUSIC_LEVEL * (this.ducks > 0 ? DUCK_RATIO : 1);
  }

  private apply(timeConstant: number): void {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, timeConstant);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stopSource();
    this.apply(0.05);
  }

  /** Lower the music. Counted, so overlapping speech needs the same
   *  number of `release` calls and never leaves it stuck low. */
  duck(): void {
    this.ducks++;
    this.apply(0.05);
  }

  release(): void {
    this.ducks = Math.max(0, this.ducks - 1);
    this.apply(0.3);
  }

  get ducked(): boolean {
    return this.ducks > 0;
  }

  /** Use a file from the user's own device in place of the generated
   *  loops, or pass null to go back. The URL stays local. */
  setFile(file: File | null): void {
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
    this.fileUrl = file ? URL.createObjectURL(file) : null;
    if (this.playing) this.play(this.playing);
  }

  play(kind: MusicKind): void {
    this.playing = kind;
    if (!this.enabled || !this.ctx || !this.master) return;
    this.stopSource();
    try {
      if (this.fileUrl && this.ctx.createMediaElementSource) {
        const el = this.makeAudio(this.fileUrl);
        el.loop = true;
        this.ctx.createMediaElementSource(el).connect(this.master);
        void el.play().catch(() => {});
        this.element = el;
        return;
      }
      const data = renderLoop(kind, this.ctx.sampleRate);
      const buffer = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
      buffer.copyToChannel(data, 0);
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.connect(this.master);
      src.start();
      this.source = src;
    } catch {
      // Music is garnish; failing to start it must not stop the workout.
    }
  }

  private stopSource(): void {
    try {
      this.source?.stop();
    } catch {
      /* already stopped */
    }
    this.source = null;
    this.element?.pause();
    this.element = null;
  }

  stop(): void {
    this.playing = null;
    this.stopSource();
  }

  dispose(): void {
    this.stop();
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
    this.fileUrl = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.master = null;
  }
}

/** Speaks with the music held down for exactly as long as the voice is
 *  going. The release rides on `onEnd`, which `speak` guarantees to call
 *  once on every path, so the music cannot be left quiet. */
export function speakDucked(
  mixer: Pick<Mixer, "duck" | "release">,
  text: string,
  options: Parameters<typeof speak>[1] = {},
  speakFn: typeof speak = speak,
) {
  mixer.duck();
  let released = false;
  return speakFn(text, {
    ...options,
    onEnd: () => {
      if (!released) {
        released = true;
        mixer.release();
      }
      options.onEnd?.();
    },
  });
}
