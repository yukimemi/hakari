import { describe, expect, it, vi } from "vitest";
import { buildSessionEntry, persistSession } from "./record";
import { initialState, planSession, reduce } from "./session";
import type { PlanExercise, WorkoutEntry } from "../../shared/schema";

const ex = (id: string, sets: number): PlanExercise => ({
  id, name: id === "squat" ? "スクワット" : id, sets, reps: "10回", restSec: 20, cue: "x",
});

function finished(stop = false) {
  const steps = planSession([ex("squat", 2)], {}).steps;
  let s = reduce(initialState(), { type: "start", now: 0, steps, checkin: { energy: "ok" }, adjustments: [] });
  s = reduce(s, { type: "completeSet", now: 30_000 });
  s = reduce(s, { type: "rateSet", rpe: 6 });
  s = reduce(s, { type: "tick", now: 50_000 });
  if (stop) return reduce(s, { type: "stop", now: 60_000 });
  return reduce(s, { type: "completeSet", now: 80_000 });
}

describe("buildSessionEntry", () => {
  it("builds a normal workout record with an estimate and its basis", () => {
    const built = buildSessionEntry({
      state: finished(),
      sessionId: "sess-1",
      date: "2026-10-08",
      weight: { kg: 60, source: "latest" },
    })!;
    expect(built.entry).toMatchObject({
      date: "2026-10-08",
      source: "session",
      sessionId: "sess-1",
      sets: 2,
      rpe: 6,
      energy: "ok",
      intensity: "standard",
    });
    expect(built.entry.minutes).toBeCloseTo(1, 1); // 60 s of exercise, rest excluded
    expect(built.entry.kcalBurned).toBe(5); // 5 METs * 60 kg * 1/60 h
    expect(built.entry.kcalEstimated).toBe(5);
    expect(built.entry.kcalBasis).toMatch(/^推定/);
    expect(built.entry.stoppedEarly).toBeUndefined();
  });

  it("saves a session stopped early, marked as such", () => {
    const built = buildSessionEntry({
      state: finished(true),
      sessionId: "s",
      date: "2026-10-08",
      weight: { kg: 60, source: "start" },
    })!;
    expect(built.entry.stoppedEarly).toBe(true);
    expect(built.entry.sets).toBe(1);
  });

  it("writes no record when nothing was completed", () => {
    const steps = planSession([ex("squat", 2)], {}).steps;
    let s = reduce(initialState(), { type: "start", now: 0, steps, checkin: {}, adjustments: [] });
    s = reduce(s, { type: "stop", now: 5000 });
    expect(buildSessionEntry({ state: s, sessionId: "s", date: "d", weight: undefined })).toBeNull();
  });

  it("still saves, with 0 kcal and the reason, when no weight is known", () => {
    const built = buildSessionEntry({ state: finished(), sessionId: "s", date: "2026-10-08", weight: undefined })!;
    expect(built.entry.kcalBurned).toBe(0);
    expect(built.entry.kcalEstimated).toBeUndefined();
    expect(built.entry.kcalBasis).toContain("体重");
  });
});

describe("persistSession", () => {
  const entry = { date: "2026-10-08", name: "n", kcalBurned: 5 } as WorkoutEntry;
  const nowait = async () => {};

  it("always writes under the session id, so repeats overwrite", async () => {
    const docs = new Map<string, WorkoutEntry>();
    const save = async (e: WorkoutEntry, id: string) => void docs.set(id, e);
    await persistSession(save, entry, "sess-1", 3, nowait);
    await persistSession(save, { ...entry, kcalBurned: 9 }, "sess-1", 3, nowait);
    expect(docs.size).toBe(1);
    expect(docs.get("sess-1")!.kcalBurned).toBe(9);
  });

  it("retries a failed save with the same id", async () => {
    const save = vi
      .fn<(e: WorkoutEntry, id: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce();
    await persistSession(save, entry, "sess-1", 3, nowait);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls.map((c) => c[1])).toEqual(["sess-1", "sess-1"]);
  });

  it("gives up with the error after the attempts run out", async () => {
    const save = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(persistSession(save, entry, "s", 2, nowait)).rejects.toThrow("offline");
    expect(save).toHaveBeenCalledTimes(2);
  });
});
