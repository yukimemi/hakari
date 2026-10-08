import { describe, expect, it } from "vitest";
import {
  currentSet,
  estimateSeconds,
  initialState,
  pacedReps,
  parseAmount,
  planSession,
  reduce,
  summarise,
  type SessionState,
  type Step,
} from "./session";
import type { PlanExercise } from "../../shared/schema";

const ex = (id: string, sets: number, reps: string, restSec = 30): PlanExercise => ({
  id,
  name: id,
  sets,
  reps,
  restSec,
  cue: "コツ",
});

const MENU = [ex("squat", 3, "10回"), ex("pushup", 2, "8回"), ex("plank", 2, "30秒")];

function begin(opts: { oneSet?: boolean; steps?: Step[] } = {}): SessionState {
  const steps = opts.steps ?? planSession(MENU, {}).steps;
  return reduce(initialState(), {
    type: "start",
    now: 0,
    steps,
    checkin: {},
    adjustments: [],
    oneSet: opts.oneSet,
  });
}

describe("parseAmount", () => {
  it("reads reps and seconds", () => {
    expect(parseAmount("12回")).toEqual({ kind: "reps", count: 12 });
    expect(parseAmount("12")).toEqual({ kind: "reps", count: 12 });
    expect(parseAmount("３０秒")).toEqual({ kind: "seconds", seconds: 30 });
  });
  it("refuses what it cannot read instead of guessing", () => {
    expect(parseAmount("12,10,8")).toBeNull();
    expect(parseAmount("限界まで")).toBeNull();
    expect(parseAmount("0回")).toBeNull();
  });
});

describe("planSession", () => {
  it("leaves the plan alone when nothing was answered", () => {
    const p = planSession(MENU, {});
    expect(p.steps.map((s) => s.sets)).toEqual([3, 2, 2]);
    expect(p.adjustments).toEqual([]);
  });

  it("trims to the available minutes and says so", () => {
    const p = planSession(MENU, { minutes: 5 });
    const full = planSession(MENU, {});
    const total = (x: typeof p) => x.steps.reduce((n, s) => n + s.sets, 0);
    expect(total(p)).toBeLessThan(total(full));
    expect(p.adjustments.join()).toContain("5分");
  });

  it("eases off for low energy", () => {
    const p = planSession(MENU, { energy: "low" });
    expect(p.steps[0]!.sets).toBe(2);
    expect(p.steps[0]!.amount).toEqual({ kind: "reps", count: 8 });
  });

  it("asks about amounts it cannot read, and takes the answer", () => {
    const odd = [ex("squat", 2, "12,10,8")];
    expect(planSession(odd, {}).unresolved).toHaveLength(1);
    const p = planSession(odd, {}, { squat: { kind: "reps", count: 10 } });
    expect(p.unresolved).toHaveLength(0);
    expect(p.steps).toHaveLength(1);
  });
});

describe("estimateSeconds", () => {
  it("counts the rests between exercises, not only between sets", () => {
    const steps = planSession(
      [ex("squat", 1, "20回", 90), ex("pushup", 1, "20回", 90), ex("plank", 1, "60秒", 90)],
      {},
    ).steps;
    // 60 + 60 + 60 of work, 90 + 90 of rest (none after the last set)
    expect(estimateSeconds(steps)).toBe(360);
  });

  it("trims to a budget using that estimate", () => {
    const menu = [ex("squat", 1, "20回", 90), ex("pushup", 1, "20回", 90), ex("plank", 1, "60秒", 90)];
    const p = planSession(menu, { minutes: 5 });
    expect(estimateSeconds(p.steps)).toBeLessThanOrEqual(300);
    expect(p.steps.length).toBeLessThan(3);
  });
});

describe("session reducer", () => {
  it("walks active -> rest -> active -> done", () => {
    let s = begin({ steps: planSession([ex("squat", 2, "10回", 20)], {}).steps });
    expect(s.phase).toBe("active");
    s = reduce(s, { type: "completeSet", now: 30_000 });
    expect(s.phase).toBe("rest");
    expect(s.restLeftMs).toBe(20_000);
    s = reduce(s, { type: "tick", now: 50_000 });
    expect(s.phase).toBe("active");
    s = reduce(s, { type: "completeSet", now: 80_000 });
    expect(s.phase).toBe("done");
    expect(s.results).toHaveLength(2);
    expect(s.stoppedEarly).toBe(false);
  });

  it("books exercise time and rest time separately", () => {
    let s = begin();
    s = reduce(s, { type: "completeSet", now: 20_000 });
    s = reduce(s, { type: "tick", now: 30_000 });
    expect(s.activeMs).toBe(20_000);
    expect(s.restMs).toBe(10_000);
  });

  it("does not accrue exercise time while paused", () => {
    let s = begin();
    s = reduce(s, { type: "tick", now: 10_000 });
    s = reduce(s, { type: "pause", now: 10_000 });
    s = reduce(s, { type: "tick", now: 100_000 });
    s = reduce(s, { type: "resume", now: 100_000 });
    s = reduce(s, { type: "tick", now: 105_000 });
    expect(s.activeMs).toBe(15_000);
    expect(pacedReps(s)).toBe(5);
  });

  it("does not run the rest timer while paused, and ignores completing", () => {
    let s = begin();
    s = reduce(s, { type: "completeSet", now: 1000 });
    s = reduce(s, { type: "pause", now: 2000 });
    s = reduce(s, { type: "tick", now: 60_000 });
    expect(s.restLeftMs).toBe(29_000);
    expect(reduce(s, { type: "skipRest", now: 60_000 }).phase).toBe("rest");
  });

  it("shrinks what is left when intensity is reduced, current set included", () => {
    let s = begin();
    const before = s.queue.length;
    s = reduce(s, { type: "reduceIntensity", now: 1000 });
    expect(s.reduced).toBe(true);
    expect(s.queue.length).toBe(before - 1);
    expect(currentSet(s)!.amount).toEqual({ kind: "reps", count: 8 });
  });

  it("never reduces away the set in hand", () => {
    let s = begin({ steps: planSession([ex("squat", 1, "10回")], {}).steps });
    s = reduce(s, { type: "reduceIntensity", now: 1000 });
    expect(s.queue).toHaveLength(1);
  });

  it("keeps completed sets exactly as done when stopped early", () => {
    let s = begin();
    s = reduce(s, { type: "completeSet", now: 20_000, actual: 7 });
    s = reduce(s, { type: "stop", now: 25_000 });
    expect(s.phase).toBe("done");
    expect(s.stoppedEarly).toBe(true);
    const sum = summarise(s);
    expect(sum.setsDone).toBe(1);
    expect(s.results[0]).toMatchObject({ actual: 7, corrected: true });
    expect(sum.perExercise[0]!.actual).toBe("7回");
  });

  it("starts with a single set and lets the user continue", () => {
    let s = begin({ oneSet: true });
    expect(s.queue).toHaveLength(1);
    expect(s.held.length).toBeGreaterThan(0);
    s = reduce(s, { type: "completeSet", now: 10_000 });
    expect(s.phase).toBe("done");
    expect(s.stoppedEarly).toBe(false);
    s = reduce(s, { type: "continue", now: 12_000 });
    expect(s.phase).toBe("rest");
    expect(s.queue.length).toBeGreaterThan(1);
  });

  it("records self-reported effort on the set just done", () => {
    let s = begin();
    s = reduce(s, { type: "completeSet", now: 10_000 });
    s = reduce(s, { type: "rateSet", rpe: 9 });
    expect(summarise(s).rpe).toBe(9);
  });

  it("ends a stop in checkin as nothing", () => {
    const s = reduce(initialState(), { type: "stop", now: 1 });
    expect(s.phase).toBe("checkin");
  });
});
