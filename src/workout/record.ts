// Turning a finished session into the workout record, and saving it.
//
// The record goes into the same `workouts` collection as every hand-typed
// entry, so the log, the day totals and the dashboard see it with no
// special case. The document id is the session id, fixed when the session
// began: a double-fired effect, a retry after a dropped connection and a
// later correction all write the same document instead of adding another.

import type { WorkoutEntry } from "../../shared/schema";
import { sessionKcal, type SessionKcal } from "../../shared/calc";
import { summarise, type SessionState } from "./session";

export type WeightSource = { kg: number; source: "latest" | "start" } | undefined;

export function estimateFor(state: SessionState, weight: WeightSource): SessionKcal {
  const sum = summarise(state);
  return sessionKcal({
    items: sum.perExercise.map((e) => ({
      name: e.name,
      mets: e.mets,
      activeSec: e.activeSec,
    })),
    weight,
    rpe: sum.rpe,
    reduced: state.reduced,
  });
}

/** Null when nothing was completed: a session abandoned before the first
 *  set is not a workout, and recording one would be inventing it. */
export function buildSessionEntry(opts: {
  state: SessionState;
  sessionId: string;
  date: string;
  weight: WeightSource;
}): { entry: WorkoutEntry; estimate: SessionKcal } | null {
  const { state } = opts;
  const sum = summarise(state);
  if (sum.setsDone === 0) return null;

  const estimate = estimateFor(state, opts.weight);
  const names = sum.perExercise.map((e) => e.name);
  const entry: WorkoutEntry = {
    date: opts.date,
    name: `先生と運動: ${names.join("・")}`.slice(0, 100),
    minutes: Math.round((sum.activeSec / 60) * 10) / 10,
    sets: Math.min(50, sum.setsDone),
    reps: sum.perExercise.map((e) => `${e.name} ${e.actual}`).join(" / ").slice(0, 50),
    // 0 when the weight was missing: the schema requires a number, and
    // the basis line says plainly that no estimate could be made.
    kcalBurned: estimate.kcal ?? 0,
    source: "session",
    sessionId: opts.sessionId,
    intensity: state.reduced ? "light" : "standard",
    rpe: sum.rpe,
    energy: state.checkin.energy,
    stoppedEarly: state.stoppedEarly || undefined,
    kcalBasis: estimate.basis,
    kcalEstimated: estimate.kcal ?? undefined,
  };
  return { entry, estimate };
}

/** Saves under the session id, retrying the same id a few times. The
 *  retries are safe precisely because the id is fixed. */
export async function persistSession(
  save: (entry: WorkoutEntry, id: string) => Promise<unknown>,
  entry: WorkoutEntry,
  sessionId: string,
  attempts = 3,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await save(entry, sessionId);
      return;
    } catch (err) {
      last = err;
      if (i < attempts - 1) await wait(500 * (i + 1));
    }
  }
  throw last;
}
