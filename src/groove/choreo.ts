// From a beat grid to a program the avatar can play in time with the song.
//
// Everything here is a pure function of the stored analysis and the chosen
// exercises, so a program re-opened next week plays exactly as it did, and
// the avatar's pose at any moment is a function of the song's playback
// position alone — which is what keeps it on the beat however the frame
// rate stutters.
//
// The song is cut into sections of eight 4/4 bars (the "32 count" phrase
// fitness choreography is built on), each section gets one exercise, and
// each exercise gets a whole number of beats per repetition, so every rep
// starts on a beat and — with an even count — bottoms out on one too.

import { EXERCISE_BY_ID, EXERCISES, type Equipment } from "../../shared/exercises";
import type { GrooveAnalysis, GrooveLevel, GrooveSectionBrief } from "../../shared/groove";
import type { TtsPhase } from "../../shared/tts";
import type { TrainingPrefs } from "../../shared/schema";
import { MOTIONS } from "../avatar/procedural";
import { BEATS_PER_BAR } from "./beats";

export const BARS_PER_SECTION = 8;
const BEATS_PER_SECTION = BEATS_PER_BAR * BARS_PER_SECTION;

export type Section = GrooveSectionBrief & {
  /** Index into the beat grid; `endBeat` is exclusive. */
  startBeat: number;
  endBeat: number;
  /** Mean loudness across the section, before ranking into a level. */
  energy: number;
};

// ---------------------------------------------------------------------------
// The grid

/** Beat times with the user's correction applied. */
export function gridOf(analysis: Pick<GrooveAnalysis, "beats" | "offsetSec">): number[] {
  return analysis.beats.map((b) => b + analysis.offsetSec);
}

/** Time of beat `i`, extrapolated at the edge tempo outside the grid. */
export function timeOfBeat(grid: number[], i: number): number {
  const last = grid.length - 1;
  if (i <= 0) return grid[0]! + i * (grid[1]! - grid[0]!);
  if (i >= last) return grid[last]! + (i - last) * (grid[last]! - grid[last - 1]!);
  const whole = Math.floor(i);
  return grid[whole]! + (i - whole) * (grid[whole + 1]! - grid[whole]!);
}

/** Fractional beat index at time `t` — the inverse of `timeOfBeat`. */
export function beatAt(grid: number[], t: number): number {
  const last = grid.length - 1;
  if (t <= grid[0]!) return (t - grid[0]!) / (grid[1]! - grid[0]!);
  if (t >= grid[last]!) return last + (t - grid[last]!) / (grid[last]! - grid[last - 1]!);
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (grid[mid]! <= t) lo = mid;
    else hi = mid;
  }
  return lo + (t - grid[lo]!) / (grid[hi]! - grid[lo]!);
}

// ---------------------------------------------------------------------------
// Sections

export function buildSections(analysis: GrooveAnalysis): Section[] {
  const grid = gridOf(analysis);
  const count = grid.length;
  const ranges: [number, number][] = [];
  for (let start = analysis.downbeat; start < count; start += BEATS_PER_SECTION) {
    ranges.push([start, Math.min(start + BEATS_PER_SECTION, count)]);
  }
  // A stub of under four bars at the end is not worth its own exercise.
  const tail = ranges.at(-1);
  if (ranges.length > 1 && tail && tail[1] - tail[0] < BEATS_PER_SECTION / 2) {
    ranges.pop();
    ranges.at(-1)![1] = tail[1];
  }

  const energies = ranges.map(([from, to]) => {
    const slice = analysis.beatEnergy.slice(from, to);
    return slice.reduce((s, v) => s + v, 0) / Math.max(1, slice.length);
  });
  const lo = Math.min(...energies);
  const hi = Math.max(...energies);
  // A song that never changes level is all "mid", not a random split.
  const flat = !(hi > 0) || (hi - lo) / hi < 0.05;

  return ranges.map(([startBeat, endBeat], index) => {
    const relative = flat ? 0.5 : (energies[index]! - lo) / (hi - lo);
    const role =
      ranges.length >= 3 && index === 0
        ? "warmup"
        : ranges.length >= 3 && index === ranges.length - 1
          ? "cooldown"
          : "main";
    const level: GrooveLevel =
      role !== "main" ? "low" : relative < 1 / 3 ? "low" : relative < 2 / 3 ? "mid" : "high";
    return {
      index,
      startBeat,
      endBeat,
      startSec: Math.max(0, timeOfBeat(grid, startBeat)),
      endSec: timeOfBeat(grid, endBeat),
      energy: energies[index]!,
      level,
      role,
    };
  });
}

// ---------------------------------------------------------------------------
// Choosing exercises

export type PickOptions = Pick<TrainingPrefs, "equipment" | "experience" | "constraints">;

/** Pools in order of preference. Every id has a procedural motion. */
const POOLS: Record<GrooveLevel | "warmup" | "cooldown", string[]> = {
  warmup: ["walk", "calf-raise", "squat"],
  low: ["walk", "calf-raise", "glute-bridge", "dead-bug", "squat"],
  mid: [
    "squat",
    "lunge",
    "knee-pushup",
    "crunch",
    "russian-twist",
    "dumbbell-press",
    "dumbbell-row",
    "chair-dip",
    "pushup",
    "superman",
    "glute-bridge",
  ],
  high: ["jumping-jack", "high-knees", "mountain-climber", "burpee", "squat", "lunge"],
  cooldown: ["glute-bridge", "dead-bug", "plank", "calf-raise", "walk"],
};

/** Words in the user's own constraints that rule out jumping. The model
 *  reads the constraints in full; this only keeps the offline fallback
 *  from contradicting the obvious cases. */
const NO_JUMP = /ジャンプ|跳|騒音|足音|音を立て|マンション|アパート|集合住宅|膝/;
const JUMPS: Record<string, true> = { "jumping-jack": true, burpee: true };
const TOO_HARD_FOR_BEGINNERS: Record<string, true> = { burpee: true, pushup: true };

/** Whether this exercise can be shown and done with what the user has. */
export function usable(exerciseId: string, opts: PickOptions): boolean {
  const def = EXERCISE_BY_ID.get(exerciseId);
  if (!def || !MOTIONS[exerciseId]) return false;
  return (opts.equipment as Equipment[]).includes(def.equipment);
}

function allowedByRules(exerciseId: string, opts: PickOptions): boolean {
  if (!usable(exerciseId, opts)) return false;
  if (JUMPS[exerciseId] && NO_JUMP.test(opts.constraints)) return false;
  if (TOO_HARD_FOR_BEGINNERS[exerciseId] && opts.experience === "beginner") return false;
  return true;
}

/**
 * The offline choreographer: one exercise per section from the pool for
 * its level, avoiding back-to-back repeats and spreading use across the
 * pool. Also fills any section the model left empty or got wrong.
 */
export function rulePicks(
  sections: Section[],
  opts: PickOptions,
  given: (string | undefined)[] = [],
): string[] {
  const used = new Map<string, number>();
  const picks: string[] = [];
  const fallback = EXERCISES.map((e) => e.id).filter((id) => allowedByRules(id, opts));

  for (const section of sections) {
    const previous = picks.at(-1);
    const wanted = given[section.index];
    let pick: string | undefined = wanted && usable(wanted, opts) ? wanted : undefined;

    if (!pick) {
      const pool = POOLS[section.role === "main" ? section.level : section.role];
      const candidates = pool.filter((id) => allowedByRules(id, opts));
      const from = candidates.length ? candidates : fallback;
      const floorBefore = previous ? MOTIONS[previous]?.base !== "standing" : false;
      let bestCost = Infinity;
      for (const id of from) {
        const floor = MOTIONS[id]?.base !== "standing";
        const cost =
          (used.get(id) ?? 0) * 2 +
          (id === previous ? 10 : 0) +
          // Getting down to the floor and back up between every section
          // eats the beat it is supposed to land on.
          (previous && floor !== floorBefore ? 1 : 0);
        if (cost < bestCost) {
          bestCost = cost;
          pick = id;
        }
      }
    }
    // Nothing usable at all is only possible with an empty equipment list,
    // and walking needs none.
    pick ??= "walk";
    picks.push(pick);
    used.set(pick, (used.get(pick) ?? 0) + 1);
  }
  return picks;
}

// ---------------------------------------------------------------------------
// The program

/** Slower reps when the music is calm, quicker when it is not. */
const TEMPO_BIAS: Record<GrooveLevel, number> = { low: 1.2, mid: 1, high: 0.85 };
const BEAT_COUNTS = [1, 2, 4, 8, 16];

/** Whole beats per repetition, as close as the tempo allows to the speed
 *  the motion was authored at. */
export function beatsPerRep(exerciseId: string, level: GrooveLevel, beatSec: number): number {
  const target = (MOTIONS[exerciseId]?.loopSec ?? 2) * TEMPO_BIAS[level];
  let best = BEAT_COUNTS[0]!;
  for (const n of BEAT_COUNTS) {
    if (Math.abs(Math.log((n * beatSec) / target)) < Math.abs(Math.log((best * beatSec) / target))) {
      best = n;
    }
  }
  return best;
}

export type Segment = {
  exerciseId: string;
  name: string;
  startBeat: number;
  endBeat: number;
  startSec: number;
  endSec: number;
  beatsPerRep: number;
  level: GrooveLevel;
  role: Section["role"];
};

export type Program = {
  grid: number[];
  segments: Segment[];
  durationSec: number;
};

export function buildProgram(
  analysis: GrooveAnalysis,
  sections: Section[],
  picks: string[],
  durationSec: number,
): Program {
  const grid = gridOf(analysis);
  const segments = sections.map((section, i): Segment => {
    const exerciseId = picks[i] ?? "walk";
    const beatSec = (section.endSec - section.startSec) / (section.endBeat - section.startBeat);
    return {
      exerciseId,
      name: EXERCISE_BY_ID.get(exerciseId)?.name ?? exerciseId,
      startBeat: section.startBeat,
      endBeat: section.endBeat,
      startSec: section.startSec,
      endSec: Math.min(section.endSec, durationSec),
      beatsPerRep: beatsPerRep(exerciseId, section.level, beatSec),
      level: section.level,
      role: section.role,
    };
  });
  return { grid, segments, durationSec };
}

export type Pose = {
  /** Undefined outside the program (intro, outro): the avatar idles. */
  exerciseId?: string;
  /** Repetition phase; a whole number at the start of every rep. */
  phase: number;
  /** Index of the playing segment, -1 before the first, length after. */
  segment: number;
  /** Fractional beat index on the grid. */
  beat: number;
};

export function poseAt(program: Program, t: number): Pose {
  const beat = beatAt(program.grid, t);
  const { segments } = program;
  if (!segments.length || beat < segments[0]!.startBeat) return { phase: 0, segment: -1, beat };
  let lo = 0;
  let hi = segments.length;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (segments[mid]!.startBeat <= beat) lo = mid;
    else hi = mid;
  }
  const segment = segments[lo]!;
  if (beat >= segment.endBeat || t >= program.durationSec) {
    return { phase: 0, segment: segments.length, beat };
  }
  return {
    exerciseId: segment.exerciseId,
    phase: (beat - segment.startBeat) / segment.beatsPerRep,
    segment: lo,
    beat,
  };
}

// ---------------------------------------------------------------------------
// What the teacher says, and when

export type GrooveCue = {
  /** Stable id, so a line fires once however often the clock is polled. */
  key: string;
  atSec: number;
  text: string;
  phase: TtsPhase;
  kind: "count" | "cue" | "closing";
};

export const CLOSING_LINE = "最後までやりきったね!お疲れさま。";

/** Lines that do not depend on the song, so they can be fetched once. */
export function announceLine(segment: Segment, first: boolean): string {
  if (first) return `最初は${segment.name}`;
  if (segment.role === "cooldown") return `クールダウン、${segment.name}`;
  return `次は${segment.name}`;
}

/**
 * The name of each new exercise two bars before it starts, then "3, 2, 1"
 * on the last three beats, so the change lands on the downbeat. Nothing is
 * said when a section repeats the exercise before it.
 */
export function cuesFor(program: Program): GrooveCue[] {
  const cues: GrooveCue[] = [];
  const { grid, segments } = program;
  segments.forEach((segment, i) => {
    if (i > 0 && segments[i - 1]!.exerciseId === segment.exerciseId) return;
    cues.push({
      key: `announce:${i}`,
      atSec: Math.max(0, timeOfBeat(grid, segment.startBeat - 2 * BEATS_PER_BAR)),
      text: announceLine(segment, i === 0),
      phase: "exercise",
      kind: "cue",
    });
    for (let n = 3; n >= 1; n--) {
      const at = timeOfBeat(grid, segment.startBeat - n);
      if (at < 0) continue;
      cues.push({ key: `count:${i}:${n}`, atSec: at, text: String(n), phase: "exercise", kind: "count" });
    }
  });
  const last = segments.at(-1);
  if (last) {
    cues.push({ key: "closing", atSec: last.endSec, text: CLOSING_LINE, phase: "closing", kind: "closing" });
  }
  return cues.sort((a, b) => a.atSec - b.atSec);
}

/** Seconds spent in each exercise up to `untilSec`, for the kcal estimate. */
export function activeSeconds(
  program: Program,
  untilSec: number,
): { exerciseId: string; name: string; activeSec: number }[] {
  const totals = new Map<string, { exerciseId: string; name: string; activeSec: number }>();
  for (const s of program.segments) {
    const sec = Math.max(0, Math.min(s.endSec, untilSec) - s.startSec);
    if (sec <= 0) continue;
    const row = totals.get(s.exerciseId) ?? { exerciseId: s.exerciseId, name: s.name, activeSec: 0 };
    row.activeSec += sec;
    totals.set(s.exerciseId, row);
  }
  return [...totals.values()];
}
