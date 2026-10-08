// The guided session as a pure state machine.
//
// Nothing here touches React, timers or the clock: every event carries the
// `now` it happened at, and time is accounted from the gap between events.
// That keeps the rules that matter testable without fake timers — a pause
// must not accrue exercise time, easing off must shrink what is left, and
// stopping must leave a record of exactly what was done.
//
//   checkin -> active <-> rest -> done
//
// Time accrues in one of three buckets and never two: `activeMs` while a
// set is under way, `restMs` during a rest, nothing while paused.

import type { PlanExercise } from "../../shared/schema";
import { EXERCISE_BY_ID, EXERCISES, type Equipment } from "../../shared/exercises";

/** Seconds per repetition the teacher paces at. */
export const REP_SEC = 3;

export type Amount =
  | { kind: "reps"; count: number }
  | { kind: "seconds"; seconds: number };

/** Reads "12回" / "30秒" / "12" into something runnable. Anything else —
 *  "12,10,8", "左右10回ずつ", "限界まで" — is null: the caller has to ask,
 *  because a guessed count is a count the user never agreed to. */
export function parseAmount(raw: string): Amount | null {
  const text = raw.trim().replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
  const secs = /^(\d{1,3})\s*(秒|s|sec)$/i.exec(text);
  if (secs) {
    const seconds = Number(secs[1]);
    return seconds > 0 ? { kind: "seconds", seconds } : null;
  }
  const reps = /^(\d{1,3})\s*(回|reps?)?$/i.exec(text);
  if (reps) {
    const count = Number(reps[1]);
    return count > 0 ? { kind: "reps", count } : null;
  }
  return null;
}

export function describeAmount(a: Amount): string {
  return a.kind === "reps" ? `${a.count}回` : `${a.seconds}秒`;
}

function amountSeconds(a: Amount): number {
  return a.kind === "reps" ? a.count * REP_SEC : a.seconds;
}

export type Step = {
  exerciseId: string;
  name: string;
  cue: string;
  mets?: number;
  sets: number;
  amount: Amount;
  restSec: number;
};

export type Energy = "low" | "ok" | "high";

export type Checkin = {
  /** Minutes the user has. Undefined = not answered, and nothing is
   *  trimmed on the strength of a number nobody gave. */
  minutes?: number;
  energy?: Energy;
};

export type SessionPlan = {
  steps: Step[];
  /** Plain-language account of what was changed to fit today. */
  adjustments: string[];
  /** Exercises whose amount could not be read; the UI asks for them. */
  unresolved: PlanExercise[];
};

/** A catalogue-only menu for people who have not generated a plan. */
export function defaultMenu(equipment: Equipment[]): PlanExercise[] {
  const allowed = new Set<Equipment>(["none", ...equipment]);
  const picked: PlanExercise[] = [];
  const seen = new Set<string>();
  for (const def of EXERCISES) {
    if (!allowed.has(def.equipment)) continue;
    const group = def.groups[0]!;
    if (seen.has(group) || def.id === "plank") continue;
    seen.add(group);
    picked.push({
      id: def.id,
      name: def.name,
      sets: 2,
      reps: "10回",
      restSec: 45,
      cue: def.cue,
    });
    if (picked.length === 4) break;
  }
  return picked;
}

/** Rough wall-clock for one pass over the steps. A rest follows every set
 *  but the very last, so rests between exercises count too. */
export function estimateSeconds(steps: Step[]): number {
  const work = steps.reduce((sum, s) => sum + s.sets * amountSeconds(s.amount), 0);
  const rest = steps.reduce((sum, s) => sum + s.sets * s.restSec, 0);
  const last = steps.at(-1);
  return work + rest - (last ? last.restSec : 0);
}

function scaleAmount(a: Amount, factor: number): Amount {
  return a.kind === "reps"
    ? { kind: "reps", count: Math.max(3, Math.round(a.count * factor)) }
    : { kind: "seconds", seconds: Math.max(10, Math.round(a.seconds * factor)) };
}

/**
 * Fits the chosen exercises to what the user said about today. Equipment
 * and the exercise list are the plan's, untouched; only quantity moves.
 */
export function planSession(
  exercises: PlanExercise[],
  checkin: Checkin,
  overrides: Record<string, Amount> = {},
): SessionPlan {
  const adjustments: string[] = [];
  const unresolved: PlanExercise[] = [];
  let steps: Step[] = [];

  for (const ex of exercises) {
    const amount = overrides[ex.id] ?? parseAmount(ex.reps);
    if (!amount) {
      unresolved.push(ex);
      continue;
    }
    steps.push({
      exerciseId: ex.id,
      name: ex.name,
      cue: ex.cue,
      mets: EXERCISE_BY_ID.get(ex.id)?.mets,
      sets: Math.max(1, Math.round(ex.sets)),
      amount,
      restSec: Math.max(10, Math.round(ex.restSec)),
    });
  }

  if (checkin.energy === "low") {
    steps = steps.map((s) => ({
      ...s,
      sets: Math.max(1, s.sets - 1),
      amount: scaleAmount(s.amount, 0.8),
    }));
    adjustments.push("元気が出ない日なので、セットと回数を少し減らしました");
  }

  if (checkin.minutes !== undefined) {
    const budget = checkin.minutes * 60;
    let trimmed = false;
    while (estimateSeconds(steps) > budget && steps.length > 0) {
      trimmed = true;
      // Drop a set from the exercise that has the most, so no movement
      // vanishes while another keeps all of its sets; only when every
      // exercise is down to one set does the last one go.
      let at = -1;
      for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i]!.sets > 1 && (at < 0 || steps[i]!.sets > steps[at]!.sets)) {
          at = i;
        }
      }
      if (at >= 0) steps[at] = { ...steps[at]!, sets: steps[at]!.sets - 1 };
      else if (steps.length > 1) steps = steps.slice(0, -1);
      else break;
    }
    if (trimmed) adjustments.push(`${checkin.minutes}分に収まるよう量を調整しました`);
  }

  return { steps, adjustments, unresolved };
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export type PlannedSet = {
  stepIndex: number;
  setNo: number;
  setsOfStep: number;
  amount: Amount;
};

export type SetResult = {
  stepIndex: number;
  setNo: number;
  planned: Amount;
  /** Reps or seconds the user confirmed. Equals the plan unless corrected. */
  actual: number;
  corrected: boolean;
  /** Exercise time on the set, excluding pauses. */
  ms: number;
  /** 1-10, if the user told us after the set. */
  rpe?: number;
};

export type Phase = "checkin" | "active" | "rest" | "done";

export type SessionState = {
  phase: Phase;
  paused: boolean;
  steps: Step[];
  queue: PlannedSet[];
  /** Sets held back by a one-set start, offered after it. */
  held: PlannedSet[];
  index: number;
  results: SetResult[];
  activeMs: number;
  restMs: number;
  /** Exercise time on the current set. */
  setMs: number;
  restLeftMs: number;
  lastAt: number | null;
  reduced: boolean;
  oneSet: boolean;
  stoppedEarly: boolean;
  checkin: Checkin;
  adjustments: string[];
};

export type SessionEvent =
  | { type: "start"; now: number; steps: Step[]; checkin: Checkin; adjustments: string[]; oneSet?: boolean }
  | { type: "tick"; now: number }
  | { type: "completeSet"; now: number; actual?: number }
  | { type: "rateSet"; rpe: number }
  | { type: "skipRest"; now: number }
  | { type: "reduceIntensity"; now: number }
  | { type: "pause"; now: number }
  | { type: "resume"; now: number }
  | { type: "continue"; now: number }
  | { type: "stop"; now: number };

export function initialState(): SessionState {
  return {
    phase: "checkin",
    paused: false,
    steps: [],
    queue: [],
    held: [],
    index: 0,
    results: [],
    activeMs: 0,
    restMs: 0,
    setMs: 0,
    restLeftMs: 0,
    lastAt: null,
    reduced: false,
    oneSet: false,
    stoppedEarly: false,
    checkin: {},
    adjustments: [],
  };
}

export function flatten(steps: Step[]): PlannedSet[] {
  return steps.flatMap((step, stepIndex) =>
    Array.from({ length: step.sets }, (_, i) => ({
      stepIndex,
      setNo: i + 1,
      setsOfStep: step.sets,
      amount: step.amount,
    })),
  );
}

/** Books the time since the last event into the right bucket. A pause,
 *  and any phase without a clock, books nothing — but still moves the
 *  marker so the gap is not charged to whoever resumes. */
function advance(state: SessionState, now: number): SessionState {
  if (state.lastAt === null) return { ...state, lastAt: now };
  const delta = Math.max(0, now - state.lastAt);
  if (state.paused || delta === 0) return { ...state, lastAt: now };

  if (state.phase === "active") {
    return {
      ...state,
      lastAt: now,
      activeMs: state.activeMs + delta,
      setMs: state.setMs + delta,
    };
  }
  if (state.phase === "rest") {
    const used = Math.min(delta, state.restLeftMs);
    const left = state.restLeftMs - used;
    const next = { ...state, lastAt: now, restMs: state.restMs + used, restLeftMs: left };
    if (left > 0) return next;
    return { ...next, phase: "active", setMs: 0 };
  }
  return { ...state, lastAt: now };
}

export function currentSet(state: SessionState): PlannedSet | null {
  return state.queue[state.index] ?? null;
}

/** Reps the pace has reached on the current set — guidance, not a count
 *  of what the user did. */
export function pacedReps(state: SessionState): number {
  const set = currentSet(state);
  if (!set || set.amount.kind !== "reps") return 0;
  return Math.min(set.amount.count, Math.floor(state.setMs / (REP_SEC * 1000)));
}

export function secondsLeftInSet(state: SessionState): number | null {
  const set = currentSet(state);
  if (!set || set.amount.kind !== "seconds") return null;
  return Math.max(0, Math.ceil(set.amount.seconds - state.setMs / 1000));
}

function finishSet(state: SessionState, actual?: number): SessionState {
  const set = currentSet(state)!;
  const planned = set.amount;
  const plannedN = planned.kind === "reps" ? planned.count : planned.seconds;
  const value = actual !== undefined && actual > 0 ? Math.round(actual) : plannedN;
  const results = [
    ...state.results,
    {
      stepIndex: set.stepIndex,
      setNo: set.setNo,
      planned,
      actual: value,
      corrected: value !== plannedN,
      ms: state.setMs,
    },
  ];
  const nextIndex = state.index + 1;
  if (nextIndex >= state.queue.length) {
    return { ...state, results, index: nextIndex, phase: "done", setMs: 0 };
  }
  return {
    ...state,
    results,
    index: nextIndex,
    phase: "rest",
    setMs: 0,
    restLeftMs: state.steps[set.stepIndex]!.restSec * 1000,
  };
}

export function reduce(state: SessionState, event: SessionEvent): SessionState {
  if (event.type === "start") {
    if (state.phase !== "checkin" || event.steps.length === 0) return state;
    const all = flatten(event.steps);
    const queue = event.oneSet ? all.slice(0, 1) : all;
    return {
      ...initialState(),
      phase: "active",
      steps: event.steps,
      queue,
      held: event.oneSet ? all.slice(1) : [],
      oneSet: Boolean(event.oneSet),
      checkin: event.checkin,
      adjustments: event.oneSet
        ? [...event.adjustments, "やる気が出ない日なので、まず1セットだけ始めました"]
        : event.adjustments,
      lastAt: event.now,
    };
  }

  if (event.type === "rateSet") {
    const last = state.results.length - 1;
    if (last < 0) return state;
    const results = state.results.slice();
    results[last] = { ...results[last]!, rpe: event.rpe };
    return { ...state, results };
  }

  if (state.phase === "checkin") return state;

  // A finished session still accepts `continue` after a one-set start.
  if (state.phase === "done") {
    if (event.type === "continue" && state.held.length > 0 && !state.stoppedEarly) {
      const queue = [...state.queue, ...state.held];
      return {
        ...state,
        queue,
        held: [],
        oneSet: false,
        phase: "rest",
        paused: false,
        restLeftMs: 20_000,
        lastAt: event.now,
      };
    }
    return state;
  }

  if (event.type === "pause") {
    const s = advance(state, event.now);
    return s.paused ? s : { ...s, paused: true };
  }
  if (event.type === "resume") {
    // Advance first, while still paused, so the gap books nothing.
    const s = advance(state, event.now);
    return { ...s, paused: false };
  }

  const s = advance(state, event.now);
  switch (event.type) {
    case "tick":
      return s;
    case "completeSet":
      if (s.phase !== "active" || s.paused) return s;
      return finishSet(s, event.actual);
    case "skipRest":
      return s.phase === "rest" && !s.paused
        ? { ...s, phase: "active", setMs: 0, restLeftMs: 0 }
        : s;
    case "reduceIntensity": {
      // The current set is the one in hand: its target shrinks too, so
      // "easier" applies from now, not from the next set.
      const queue = s.queue.map((set, i) =>
        i < s.index ? set : { ...set, amount: scaleAmount(set.amount, 0.75) },
      );
      // Fewer sets as well, but never the one being done and never the
      // only one left.
      const keep = queue.length - s.index > 2 ? queue.slice(0, -1) : queue;
      return { ...s, queue: keep, reduced: true };
    }
    case "continue":
      return s;
    case "stop":
      return { ...s, phase: "done", stoppedEarly: true, paused: false, setMs: 0 };
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export type SessionSummary = {
  setsDone: number;
  setsPlanned: number;
  activeSec: number;
  /** Per exercise, from the sets actually completed. A set abandoned
   *  mid-way is not counted as done. */
  perExercise: { exerciseId: string; name: string; mets?: number; activeSec: number; sets: number; actual: string }[];
  rpe?: number;
};

export function summarise(state: SessionState): SessionSummary {
  const byStep = new Map<number, SetResult[]>();
  for (const r of state.results) {
    byStep.set(r.stepIndex, [...(byStep.get(r.stepIndex) ?? []), r]);
  }
  const perExercise = [...byStep.entries()].map(([stepIndex, rs]) => {
    const step = state.steps[stepIndex]!;
    const unit = rs[0]!.planned.kind === "reps" ? "回" : "秒";
    return {
      exerciseId: step.exerciseId,
      name: step.name,
      mets: step.mets,
      sets: rs.length,
      activeSec: rs.reduce((sum, r) => sum + r.ms, 0) / 1000,
      actual: rs.map((r) => `${r.actual}${unit}`).join(","),
    };
  });
  const rated = state.results.filter((r) => r.rpe !== undefined);
  return {
    setsDone: state.results.length,
    setsPlanned: state.queue.length + state.held.length,
    activeSec: Math.round(state.activeMs / 1000),
    perExercise,
    rpe: rated.length
      ? Math.round(rated.reduce((s, r) => s + r.rpe!, 0) / rated.length)
      : undefined,
  };
}
