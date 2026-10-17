import { describe, expect, it } from "vitest";
import { ANALYSIS_RATE, analyse } from "./beats";

/** A drum loop: kick on every beat (heavier on the one), a snare on the
 *  backbeat, off-beat hats, and a quiet pad so it is never pure silence. */
function drumTrack(opts: {
  bpm: number;
  seconds: number;
  firstBeat: number;
  /** Beat number (from 0) that carries the bar's accent. */
  accentOn: number;
}): { samples: Float32Array; truth: number[] } {
  const rate = ANALYSIS_RATE;
  const samples = new Float32Array(Math.round(opts.seconds * rate));
  const beat = 60 / opts.bpm;
  const truth: number[] = [];
  let seed = 7;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 1073741824 - 1;
  };

  for (let i = 0; i < samples.length; i++) {
    samples[i] = 0.02 * Math.sin((2 * Math.PI * 220 * i) / rate);
  }
  for (let n = 0; opts.firstBeat + n * beat < opts.seconds - 0.3; n++) {
    const at = opts.firstBeat + n * beat;
    truth.push(at);
    const bar = (((n - opts.accentOn) % 4) + 4) % 4;
    const accent = bar === 0 ? 1 : 0.45;
    const start = Math.round(at * rate);
    for (let k = 0; k < rate * 0.15 && start + k < samples.length; k++) {
      const t = k / rate;
      // A beater click on top of the body, as a real kick has.
      const click = t < 0.004 ? 0.3 * noise() : 0;
      samples[start + k]! += accent * (0.8 * Math.exp(-t * 30) * Math.sin(2 * Math.PI * 60 * t) + click);
      if (bar === 1 || bar === 3) samples[start + k]! += 0.3 * Math.exp(-t * 25) * noise();
    }
    const hat = Math.round((at + beat / 2) * rate);
    for (let k = 0; k < rate * 0.03 && hat + k < samples.length; k++) {
      samples[hat + k]! += 0.1 * Math.exp(-(k / rate) * 150) * noise();
    }
  }
  return { samples, truth };
}

function nearestError(found: number[], truth: number[]): number[] {
  return truth.map((t) => Math.min(...found.map((f) => Math.abs(f - t))));
}

describe("analyse", () => {
  it.each([
    { bpm: 128, accentOn: 0 },
    { bpm: 92, accentOn: 2 },
    { bpm: 174, accentOn: 1 },
  ])("locks onto a $bpm BPM grid", ({ bpm, accentOn }) => {
    const { samples, truth } = drumTrack({ bpm, seconds: 40, firstBeat: 0.6, accentOn });
    const result = analyse(samples, ANALYSIS_RATE);

    expect(result.bpm).toBeGreaterThan(bpm * 0.99);
    expect(result.bpm).toBeLessThan(bpm * 1.01);

    // Every true beat away from the edges has a detected beat within 25 ms,
    // which is below what anyone can see on an avatar at 30-60 fps.
    const inner = truth.slice(2, -2);
    expect(Math.max(...nearestError(result.beats, inner))).toBeLessThan(0.025);
    expect(result.beats.length).toBeGreaterThanOrEqual(inner.length);

    // The bar starts on the accented beat.
    const firstBarAt = result.beats[result.downbeat]!;
    const index = truth.findIndex((t) => Math.abs(t - firstBarAt) < 0.03);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index % 4).toBe(accentOn);

    expect(result.beatEnergy).toHaveLength(result.beats.length);
  });

  it("does not invent beats in the silence around the music", () => {
    const { samples } = drumTrack({ bpm: 120, seconds: 20, firstBeat: 0.5, accentOn: 0 });
    const padded = new Float32Array(samples.length + ANALYSIS_RATE * 10);
    padded.set(samples, ANALYSIS_RATE * 5);
    const result = analyse(padded, ANALYSIS_RATE);
    expect(result.beats[0]).toBeGreaterThan(5.3);
    expect(result.beats.at(-1)).toBeLessThan(25.3);
  });
});
