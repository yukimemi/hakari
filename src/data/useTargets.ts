// The day's numbers, derived once.
//
// Two screens were each working these out for themselves and disagreeing:
// the meals tab sized its bar against the *starting* weight and treated
// maintenance as the budget, while the dashboard used the current weight
// and the goal pace. That put "あと 1,187 kcal" on one tab and "残り約
// 340kcal" on the other, for the same moment of the same day — and the
// larger, wronger number was the one attached to the button that adds
// food.
//
// Anything that answers "how much is left today" reads it from here.

import { useMemo } from "react";
import { useUserDoc } from "./userDocContext";
import { useWeights } from "./hooks";
import {
  ageFrom,
  bmr,
  minimumIntake,
  movingAverage,
  pace,
  safeTargetDate,
  tdeeForProfile,
  todayKey,
} from "../../shared/calc";

export type Targets = {
  /** The trend weight, not this morning's reading — a single weigh-in
   *  swings a kilo on water alone. */
  currentKg: number;
  /** Maintenance: what the body spends. Eating this much holds still. */
  tdeeKcal: number;
  /** The daily shortfall the goal date demands. */
  requiredDailyDeficit: number;
  /** What to actually eat today: maintenance minus that shortfall. This is
   *  the number a diet app means by "budget"; maintenance is the ceiling
   *  above which the day moves backwards. */
  targetIntakeKcal: number;
  /** The floor: basal metabolism, or an absolute minimum, whichever is
   *  higher. Eating under this is not a faster diet, it is muscle loss. */
  minimumIntakeKcal: number;
  /** True when the goal date demands eating below that floor. */
  belowMinimum: boolean;
  /** The nearest target date that would not. Null when even maintenance
   *  sits at the floor, i.e. when no date alone fixes it. */
  safeDate: string | null;
  /** Grams of protein worth aiming at. In a deficit the body will spend
   *  muscle unless protein is kept high, which is the difference between
   *  losing fat and merely losing weight. 1.6g per kg of *goal* weight is
   *  the usual figure — goal rather than current, so someone carrying a
   *  lot of fat is not asked to eat for a body they are trying to leave. */
  proteinTargetG: number;
};

export function useTargets(): Targets | null {
  const { data: user } = useUserDoc();
  const { data: weights } = useWeights();

  return useMemo(() => {
    const { profile, goal } = user;
    if (!profile || !goal) return null;

    const series = weights.map((w) => ({ date: w.date, value: w.weightKg }));
    const smoothed = movingAverage(series, 7);
    const currentKg =
      smoothed.at(-1)?.value ?? series.at(-1)?.value ?? goal.startWeightKg;

    const tdeeKcal = tdeeForProfile(profile, currentKg);
    const { requiredDailyDeficit } = pace({
      currentKg,
      targetKg: goal.targetWeightKg,
      today: todayKey(),
      targetDate: goal.targetDate,
    });

    const targetIntakeKcal = Math.round(tdeeKcal - requiredDailyDeficit);
    const minimumIntakeKcal = Math.round(
      minimumIntake(
        bmr({
          weightKg: currentKg,
          heightCm: profile.heightCm,
          age: ageFrom(profile.birthYear),
          sex: profile.sex,
        }),
        profile.sex,
      ),
    );

    return {
      currentKg,
      tdeeKcal,
      requiredDailyDeficit,
      targetIntakeKcal,
      minimumIntakeKcal,
      belowMinimum: targetIntakeKcal < minimumIntakeKcal,
      proteinTargetG: Math.round(goal.targetWeightKg * 1.6),
      safeDate: safeTargetDate({
        remainingKg: currentKg - goal.targetWeightKg,
        tdee: tdeeKcal,
        minimum: minimumIntakeKcal,
        from: todayKey(),
      }),
    };
  }, [user, weights]);
}
