// React bindings over the Firestore layer. Every hook is a live
// subscription — the dashboard updates the moment a meal is logged on the
// phone, without a refresh.

import { useEffect, useMemo, useState } from "react";
import { useUid } from "../auth/context";
import type { AccessDoc } from "../../shared/access";
import {
  settingsOf,
  watchAccess,
  watchBodyPhotos,
  watchMeals,
  watchMealsInRange,
  watchWeights,
  watchWorkoutsInRange,
  type BodyPhotoRecord,
  type StoredMeal,
  type StoredWorkout,
} from "./store";
import type { WeightEntry } from "../../shared/schema";
import { toDateKey, todayKey } from "../../shared/calc";

type Async<T> = { data: T; loading: boolean; error: Error | null };

// Shared subscription, held by <UserDocProvider> above the routes.
// Re-exported here so screens keep importing their data hooks from one place.
import { useUserDoc } from "./userDocContext";
export { useUserDoc };

/** The invite list, plus whether reading it was refused — which is the
 *  signal that the signed-in address is not on it. */
export function useAccess(): {
  access: AccessDoc;
  loading: boolean;
  denied: boolean;
} {
  const [state, setState] = useState<{
    access: AccessDoc;
    loading: boolean;
    denied: boolean;
  }>({ access: {}, loading: true, denied: false });

  useEffect(() => {
    return watchAccess(
      (access) => setState({ access, loading: false, denied: false }),
      () => setState({ access: {}, loading: false, denied: true }),
    );
  }, []);

  return state;
}

export function useSettings() {
  const { data, loading, error } = useUserDoc();
  return { settings: settingsOf(data), loading, error };
}

export function useWeights(): Async<WeightEntry[]> {
  const uid = useUid();
  const [state, setState] = useState<Async<WeightEntry[]>>({
    data: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    return watchWeights(
      uid,
      (data) => setState({ data, loading: false, error: null }),
      (error) => setState((s) => ({ ...s, loading: false, error })),
    );
  }, [uid]);

  return state;
}

/** The day's workouts. Same shape as useMealsOfDay — a day has two
 *  ledgers, and the screens that show one usually need the other. */
export function useWorkoutsOfDay(date: string): Async<StoredWorkout[]> {
  const uid = useUid();
  const [state, setState] = useState<
    Async<StoredWorkout[]> & { loadedFor: string | null }
  >({ data: [], loading: true, error: null, loadedFor: null });

  useEffect(() => {
    return watchWorkoutsInRange(
      uid,
      date,
      date,
      (data) => setState({ data, loading: false, error: null, loadedFor: date }),
      (error) =>
        setState((s) => ({ ...s, loading: false, error, loadedFor: date })),
    );
  }, [uid, date]);

  const settled = state.loadedFor === date;
  return {
    data: settled ? state.data : [],
    loading: !settled,
    error: settled ? state.error : null,
  };
}

export function useMealsOfDay(date: string): Async<StoredMeal[]> {
  const uid = useUid();
  // `loadedFor` tracks which date the snapshot belongs to, so switching
  // days reports "loading" without a state write inside the effect — and
  // without briefly showing the previous day's meals as if they were this
  // day's.
  const [state, setState] = useState<Async<StoredMeal[]> & { loadedFor: string | null }>(
    { data: [], loading: true, error: null, loadedFor: null },
  );

  useEffect(() => {
    return watchMeals(
      uid,
      date,
      (data) => setState({ data, loading: false, error: null, loadedFor: date }),
      (error) =>
        setState((s) => ({ ...s, loading: false, error, loadedFor: date })),
    );
  }, [uid, date]);

  const settled = state.loadedFor === date;
  return {
    data: settled ? state.data : [],
    loading: !settled,
    error: settled ? state.error : null,
  };
}

/** `days` counts back from today inclusive. */
export function useRecentLogs(days = 14) {
  const uid = useUid();
  const [meals, setMeals] = useState<StoredMeal[]>([]);
  const [workouts, setWorkouts] = useState<StoredWorkout[]>([]);
  const [error, setError] = useState<Error | null>(null);

  const range = useMemo(() => {
    const to = todayKey();
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    return { from: toDateKey(from), to };
  }, [days]);

  useEffect(() => {
    const unsubMeals = watchMealsInRange(
      uid,
      range.from,
      range.to,
      setMeals,
      setError,
    );
    const unsubWorkouts = watchWorkoutsInRange(
      uid,
      range.from,
      range.to,
      setWorkouts,
      setError,
    );
    return () => {
      unsubMeals();
      unsubWorkouts();
    };
  }, [uid, range.from, range.to]);

  /** kcal in, kcal burned and the macros behind them, keyed by date.
   *
   *  The macros are here because advice about a day is often about its
   *  composition rather than its total: 900 kcal with 21g of protein and
   *  900 kcal with 90g are the same number and not the same day. */
  const byDate = useMemo(() => {
    const blank = () => ({
      intakeKcal: 0,
      burnedKcal: 0,
      proteinG: 0,
      fatG: 0,
      carbsG: 0,
    });
    const map = new Map<string, ReturnType<typeof blank>>();
    const row = (date: string) => {
      const existing = map.get(date) ?? blank();
      map.set(date, existing);
      return existing;
    };

    for (const meal of meals) {
      const day = row(meal.date);
      day.intakeKcal += meal.totalKcal;
      for (const item of meal.items) {
        day.proteinG += item.proteinG;
        day.fatG += item.fatG;
        day.carbsG += item.carbsG;
      }
    }
    for (const workout of workouts) {
      row(workout.date).burnedKcal += workout.kcalBurned;
    }
    return map;
  }, [meals, workouts]);

  return { meals, workouts, byDate, range, error };
}

export function useBodyPhotos(): Async<BodyPhotoRecord[]> {
  const uid = useUid();
  const [state, setState] = useState<Async<BodyPhotoRecord[]>>({
    data: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    return watchBodyPhotos(
      uid,
      (data) => setState({ data, loading: false, error: null }),
      (error) => setState((s) => ({ ...s, loading: false, error })),
    );
  }, [uid]);

  return state;
}
