// Beat tracking for a song the user picked on their own device.
//
// Runs in the browser on decoded samples and never touches the network:
// the song is the user's, and nothing about finding its beat needs a
// server. The method is the classic one (Ellis 2007, the same shape as
// librosa's `beat_track`), because it is deterministic and accurate on
// what people exercise to — songs with a steady tempo:
//
//   1. onset strength: spectral flux of a log-magnitude STFT,
//   2. tempo: autocorrelation of that envelope, weighted toward ~120 BPM so
//      a half- or double-time reading loses to the one a body moves at,
//   3. beats: dynamic programming that rewards landing on onsets and
//      penalises straying from the tempo, so the grid follows small drifts
//      without jumping at every snare.
//
// Where the bar starts is a heuristic (the kick tends to sit on the one),
// so the screen lets the user move it a beat at a time, and nudge the
// whole grid, rather than trusting it blindly.

/** Rate the analysis wants its input at. Plenty for rhythm, and what keeps
 *  four minutes of audio inside a few hundred milliseconds of work. */
export const ANALYSIS_RATE = 22050;

const FRAME = 1024;
const HOP = 256;
const MIN_BPM = 60;
const MAX_BPM = 200;
/** Centre and spread (in octaves) of the tempo prior. */
const PRIOR_BPM = 120;
const PRIOR_OCTAVES = 1;
/** How hard the tracker resists changing tempo. librosa's default. */
const TIGHTNESS = 100;
/** Low band whose onsets mark the downbeat, in Hz. */
const KICK_HZ = 150;
/** Mel bands the onset envelope is summed over, up to this frequency. */
const BANDS = 40;
const MAX_BAND_HZ = 8000;
export const BEATS_PER_BAR = 4;

export type BeatAnalysis = {
  /** Tempo of the tracked grid, from the median beat interval. */
  bpm: number;
  /** Beat times in seconds, ascending. */
  beats: number[];
  /** Index into `beats` of the first beat of the first full bar (0..3). */
  downbeat: number;
  /** Loudness (RMS) of the audio between each beat and the next, aligned
   *  with `beats`. Feeds the choice of how hard each section works. */
  beatEnergy: number[];
};

export class BeatError extends Error {}

/** Mixes any number of channels down to one. */
export function mixdown(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const length = channels[0]?.length ?? 0;
  const out = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < length; i++) out[i]! += channel[i]! / channels.length;
  }
  return out;
}

/** Decodes a song file straight to mono at the analysis rate. An offline
 *  context resamples during decode, so no full-rate copy is ever mixed. */
export async function analyseFile(
  data: ArrayBuffer,
): Promise<BeatAnalysis & { durationSec: number }> {
  const decoder = new OfflineAudioContext(1, 1, ANALYSIS_RATE);
  const buffer = await decoder.decodeAudioData(data);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
    buffer.getChannelData(i),
  );
  return { ...analyse(mixdown(channels), buffer.sampleRate), durationSec: buffer.duration };
}

export function analyse(samples: Float32Array, sampleRate: number): BeatAnalysis {
  const { onset, kick } = onsetEnvelopes(samples, sampleRate);
  const fps = sampleRate / HOP;
  const frames = beatTrack(onset, fps);
  if (frames.length < BEATS_PER_BAR * 2) {
    throw new BeatError("拍を検出できませんでした。リズムのはっきりした曲で試してください");
  }

  // Where in the window an attack produces its biggest rise: past the
  // centre, by about half a hop. Calibrated against synthetic clicks with
  // known times; half a frame alone read 15 ms early.
  const offset = (FRAME / 2 + HOP / 2) / sampleRate;
  const beats = frames.map((f) => Math.round((f / fps + offset) * 1000) / 1000);

  const intervals = beats.slice(1).map((b, i) => b - beats[i]!);
  const bpm = Math.round(600 / median(intervals)) / 10;

  return {
    bpm,
    beats,
    downbeat: findDownbeat(frames, kick),
    beatEnergy: energyPerBeat(samples, sampleRate, beats),
  };
}

// ---------------------------------------------------------------------------
// Onset strength

function onsetEnvelopes(
  samples: Float32Array,
  sampleRate: number,
): { onset: Float64Array; kick: Float64Array } {
  const count = Math.floor((samples.length - FRAME) / HOP) + 1;
  if (count < 2) throw new BeatError("曲が短すぎます");

  const window = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);

  // Flux is summed over mel-spaced bands, not raw FFT bins. Raw bins give a
  // hi-hat — a few hundred bins of noise — far more votes than a kick that
  // occupies three, and the tracker then locks onto the off-beat.
  const bins = FRAME / 2;
  const topMel = mel(MAX_BAND_HZ);
  const bandOf = new Int16Array(bins).fill(-1);
  for (let k = 1; k < bins; k++) {
    const hz = (k * sampleRate) / FRAME;
    if (hz <= MAX_BAND_HZ) bandOf[k] = Math.min(BANDS - 1, Math.floor((mel(hz) / topMel) * BANDS));
  }
  const kickBands = Math.max(1, Math.ceil((mel(KICK_HZ) / topMel) * BANDS));

  const fft = makeFft(FRAME);
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  const bands = new Float64Array(BANDS);
  let previous = new Float64Array(BANDS);
  let current = new Float64Array(BANDS);

  const flux = new Float64Array(count);
  const kick = new Float64Array(count);

  for (let f = 0; f < count; f++) {
    const start = f * HOP;
    for (let i = 0; i < FRAME; i++) {
      re[i] = samples[start + i]! * window[i]!;
      im[i] = 0;
    }
    fft(re, im);
    bands.fill(0);
    for (let k = 1; k < bins; k++) {
      const band = bandOf[k]!;
      if (band >= 0) bands[band]! += Math.hypot(re[k]!, im[k]!);
    }
    let sum = 0;
    let low = 0;
    for (let b = 0; b < BANDS; b++) {
      const value = Math.log1p(bands[b]!);
      current[b] = value;
      const rise = f > 0 ? value - previous[b]! : 0;
      if (rise > 0) {
        sum += rise;
        if (b < kickBands) low += rise;
      }
    }
    flux[f] = sum;
    kick[f] = low;
    [previous, current] = [current, previous];
  }

  return { onset: normalise(detrend(flux, Math.round(sampleRate / HOP))), kick };
}

function mel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

/** Subtracts a centred running mean and clips at zero, so a loud passage
 *  does not read as a run of onsets and a quiet one as none. */
function detrend(values: Float64Array, width: number): Float64Array {
  const half = Math.max(1, Math.floor(width / 2));
  const prefix = new Float64Array(values.length + 1);
  for (let i = 0; i < values.length; i++) prefix[i + 1] = prefix[i]! + values[i]!;
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length, i + half + 1);
    const mean = (prefix[hi]! - prefix[lo]!) / (hi - lo);
    out[i] = Math.max(0, values[i]! - mean);
  }
  return out;
}

function normalise(values: Float64Array): Float64Array {
  let sq = 0;
  for (const v of values) sq += v * v;
  const std = Math.sqrt(sq / Math.max(1, values.length));
  if (!(std > 0)) return values;
  return values.map((v) => v / std);
}

// ---------------------------------------------------------------------------
// Tempo and beats

/** Frames per beat, from the tempo-weighted autocorrelation. */
export function estimatePeriod(onset: Float64Array, fps: number): number {
  const minLag = Math.floor((60 * fps) / MAX_BPM);
  const maxLag = Math.ceil((60 * fps) / MIN_BPM);
  const ac = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < onset.length; i++) sum += onset[i]! * onset[i + lag]!;
    ac[lag] = sum / Math.max(1, onset.length - lag);
  }

  let best = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    const octaves = Math.log2(bpm / PRIOR_BPM) / PRIOR_OCTAVES;
    const score = ac[lag]! * Math.exp(-0.5 * octaves * octaves);
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }

  // Parabolic interpolation: a whole-frame lag is an 11 ms quantum, which
  // over a four-minute song would accumulate into whole beats of drift if
  // the tracker trusted it.
  const a = ac[best - 1]!;
  const b = ac[best]!;
  const c = ac[best + 1]!;
  const denom = a - 2 * b + c;
  const shift = denom < 0 ? (0.5 * (a - c)) / denom : 0;
  return best + Math.max(-0.5, Math.min(0.5, shift));
}

function beatTrack(onset: Float64Array, fps: number): number[] {
  const period = estimatePeriod(onset, fps);
  const n = onset.length;

  // Smear each onset a little so "near the onset" also scores.
  const reach = Math.round(period);
  const kernel: number[] = [];
  for (let k = -reach; k <= reach; k++) kernel.push(Math.exp(-0.5 * ((k * 32) / period) ** 2));
  const local = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -reach; k <= reach; k++) {
      const j = i + k;
      if (j >= 0 && j < n) sum += onset[j]! * kernel[k + reach]!;
    }
    local[i] = sum;
  }

  let peak = 0;
  for (const v of local) peak = Math.max(peak, v);
  const threshold = 0.01 * peak;

  const cumulative = new Float64Array(n);
  const backlink = new Int32Array(n).fill(-1);
  const from = Math.round(2 * period);
  const to = Math.max(1, Math.round(period / 2));
  let started = false;
  for (let i = 0; i < n; i++) {
    let best = -Infinity;
    let bestJ = -1;
    for (let j = Math.max(0, i - from); j <= i - to; j++) {
      const ratio = Math.log((i - j) / period);
      const score = cumulative[j]! - TIGHTNESS * ratio * ratio;
      if (score > best) {
        best = score;
        bestJ = j;
      }
    }
    cumulative[i] = local[i]! + (bestJ >= 0 ? best : 0);
    // Silence before the music starts is not a beat to chain from.
    if (!started && local[i]! < threshold) continue;
    started = true;
    backlink[i] = bestJ;
  }

  const last = lastBeat(cumulative);
  const beats: number[] = [];
  for (let i = last; i >= 0; i = backlink[i]!) beats.push(i);
  beats.reverse();
  return trimWeakEnds(beats, local);
}

/** The latest local maximum of the cumulative score that is not a faint
 *  echo after the music has stopped. */
function lastBeat(cumulative: Float64Array): number {
  const maxima: number[] = [];
  for (let i = 1; i < cumulative.length - 1; i++) {
    if (cumulative[i]! > cumulative[i - 1]! && cumulative[i]! >= cumulative[i + 1]!) maxima.push(i);
  }
  if (maxima.length === 0) return cumulative.length - 1;
  const threshold = 0.5 * median(maxima.map((i) => cumulative[i]!));
  for (let k = maxima.length - 1; k >= 0; k--) {
    if (cumulative[maxima[k]!]! >= threshold) return maxima[k]!;
  }
  return maxima.at(-1)!;
}

/** Drops beats at either end that sit on near-silence: the tracker keeps
 *  extrapolating the grid into a fade-out or a quiet intro. */
function trimWeakEnds(beats: number[], local: Float64Array): number[] {
  if (beats.length < 3) return beats;
  const strength = beats.map((b) => local[b]!);
  const rms = Math.sqrt(strength.reduce((s, v) => s + v * v, 0) / strength.length);
  const floor = 0.5 * rms;
  let start = 0;
  let end = beats.length;
  while (start < end && strength[start]! < floor) start++;
  while (end > start && strength[end - 1]! < floor) end--;
  return beats.slice(start, end);
}

function findDownbeat(frames: number[], kick: Float64Array): number {
  const scores = new Array<number>(BEATS_PER_BAR).fill(0);
  const counts = new Array<number>(BEATS_PER_BAR).fill(0);
  frames.forEach((f, i) => {
    let strongest = 0;
    for (let d = -2; d <= 2; d++) strongest = Math.max(strongest, kick[f + d] ?? 0);
    scores[i % BEATS_PER_BAR]! += strongest;
    counts[i % BEATS_PER_BAR]!++;
  });
  let best = 0;
  for (let k = 1; k < BEATS_PER_BAR; k++) {
    if (scores[k]! / Math.max(1, counts[k]!) > scores[best]! / Math.max(1, counts[best]!)) best = k;
  }
  return best;
}

function energyPerBeat(samples: Float32Array, sampleRate: number, beats: number[]): number[] {
  const step = median(beats.slice(1).map((b, i) => b - beats[i]!));
  return beats.map((start, i) => {
    const end = beats[i + 1] ?? start + step;
    const from = Math.max(0, Math.floor(start * sampleRate));
    const to = Math.min(samples.length, Math.ceil(end * sampleRate));
    let sq = 0;
    for (let s = from; s < to; s++) sq += samples[s]! * samples[s]!;
    return to > from ? Math.round(Math.sqrt(sq / (to - from)) * 1e4) / 1e4 : 0;
  });
}

// ---------------------------------------------------------------------------
// Utilities

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** In-place iterative radix-2 FFT for a fixed power-of-two size. */
function makeFft(size: number): (re: Float64Array, im: Float64Array) => void {
  const levels = Math.log2(size);
  if (!Number.isInteger(levels)) throw new Error("FFT size must be a power of two");
  const reverse = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    let r = 0;
    for (let b = 0; b < levels; b++) r = (r << 1) | ((i >> b) & 1);
    reverse[i] = r;
  }
  const cos = new Float64Array(size / 2);
  const sin = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / size);
    sin[i] = -Math.sin((2 * Math.PI * i) / size);
  }

  return (re, im) => {
    for (let i = 0; i < size; i++) {
      const j = reverse[i]!;
      if (j > i) {
        [re[i], re[j]] = [re[j]!, re[i]!];
        [im[i], im[j]] = [im[j]!, im[i]!];
      }
    }
    for (let len = 2; len <= size; len <<= 1) {
      const half = len >> 1;
      const stride = size / len;
      for (let start = 0; start < size; start += len) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * stride]!;
          const wi = sin[k * stride]!;
          const a = start + k;
          const b = a + half;
          const tr = re[b]! * wr - im[b]! * wi;
          const ti = re[b]! * wi + im[b]! * wr;
          re[b] = re[a]! - tr;
          im[b] = im[a]! - ti;
          re[a] = re[a]! + tr;
          im[a] = im[a]! + ti;
        }
      }
    }
  };
}
