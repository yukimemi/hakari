// Pure calculation layer: energy expenditure, goal pacing, trend fitting.
//
// Everything here is deterministic and dependency-free so it can be unit
// tested directly and reused by both the browser and the API routes.

import type { ActivityLevel, Profile, Sex } from "./schema.js";

/** kcal stored in one kilogram of body fat. The 7700 figure assumes pure
 *  fat; real weight loss is part lean mass and water, so 7200 tracks
 *  observed outcomes better and keeps the app from over-promising. */
export const KCAL_PER_KG = 7200;

export const ACTIVITY_LEVELS = [
  "sedentary",
  "light",
  "moderate",
  "active",
  "very_active",
] as const;

const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export const ACTIVITY_LABEL: Record<ActivityLevel, string> = {
  sedentary: "ほぼ座りっぱなし",
  light: "軽い活動 (週1-3回の運動)",
  moderate: "中程度 (週3-5回の運動)",
  active: "活発に活動 (週6-7回の運動)",
  very_active: "非常に活動的 (肉体労働・毎日高強度)",
};

/** Mifflin-St Jeor. More accurate than Harris-Benedict for modern
 *  populations, and the formula most calorie apps agree on. */
export function bmr(opts: {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
}): number {
  const base = 10 * opts.weightKg + 6.25 * opts.heightCm - 5 * opts.age;
  return opts.sex === "male" ? base + 5 : base - 161;
}

export function tdee(opts: {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
  activityLevel: ActivityLevel;
}): number {
  return bmr(opts) * ACTIVITY_FACTOR[opts.activityLevel];
}

export function ageFrom(birthYear: number, today = new Date()): number {
  return Math.max(1, today.getFullYear() - birthYear);
}

/** Convenience wrapper for the common "profile + today's weight" case. */
export function tdeeForProfile(
  profile: Profile,
  weightKg: number,
  today = new Date(),
): number {
  return tdee({
    weightKg,
    heightCm: profile.heightCm,
    age: ageFrom(profile.birthYear, today),
    sex: profile.sex,
    activityLevel: profile.activityLevel,
  });
}

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

/** Health-authority BMI banding, used only for a colour hint in the UI. */
export function bmiCategory(value: number): "low" | "normal" | "over" | "obese" {
  if (value < 18.5) return "low";
  if (value < 25) return "normal";
  if (value < 30) return "over";
  return "obese";
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00`);
  const b = Date.parse(`${to}T00:00:00`);
  return Math.round((b - a) / 86_400_000);
}

export type Pace = {
  /** Kilograms still to lose (negative when already past the goal). */
  remainingKg: number;
  daysLeft: number;
  /** Daily calorie deficit required to land exactly on the target date. */
  requiredDailyDeficit: number;
  /** kg per week the plan implies. */
  requiredWeeklyKg: number;
  /** True when the plan asks for more than 1% of bodyweight per week —
   *  the point where muscle loss and rebound risk climb sharply. */
  aggressive: boolean;
  /** True when the target date has passed. */
  overdue: boolean;
};

export function pace(opts: {
  currentKg: number;
  targetKg: number;
  today: string;
  targetDate: string;
}): Pace {
  const remainingKg = opts.currentKg - opts.targetKg;
  const daysLeft = daysBetween(opts.today, opts.targetDate);
  const safeDays = Math.max(1, daysLeft);
  const requiredDailyDeficit = (remainingKg * KCAL_PER_KG) / safeDays;
  const requiredWeeklyKg = (remainingKg / safeDays) * 7;

  return {
    remainingKg,
    daysLeft,
    requiredDailyDeficit,
    requiredWeeklyKg,
    aggressive: requiredWeeklyKg > opts.currentKg * 0.01,
    overdue: daysLeft < 0,
  };
}

/**
 * Daily energy balance. Positive `deficit` means the day ran a shortfall
 * and therefore moved toward the goal.
 */
export function dailyBalance(opts: {
  tdee: number;
  intakeKcal: number;
  burnedKcal: number;
}): { deficit: number; net: number } {
  const net = opts.intakeKcal - opts.burnedKcal;
  return { deficit: opts.tdee - net, net };
}

/** kcal burned = METs x weight(kg) x hours. The MET value already covers
 *  resting metabolism, so this slightly overstates the *extra* burn; the
 *  error is small next to the uncertainty in the intake numbers. */
export function exerciseKcal(opts: {
  mets: number;
  weightKg: number;
  minutes: number;
}): number {
  return opts.mets * opts.weightKg * (opts.minutes / 60);
}

export type Point = { date: string; value: number };

/**
 * Centred-window moving average. Daily weight swings +-1kg on water alone,
 * so the raw series is close to useless for judging progress — this is
 * what the chart draws as the trend line.
 */
export function movingAverage(points: Point[], window = 7): Point[] {
  if (points.length === 0) return [];
  const half = Math.floor(window / 2);
  return points.map((p, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(points.length - 1, i + half);
    let sum = 0;
    for (let k = lo; k <= hi; k++) sum += points[k]!.value;
    return { date: p.date, value: sum / (hi - lo + 1) };
  });
}

/**
 * Least-squares slope in kg/day over the supplied points, or null when
 * there is not enough spread to fit a line. Used for the "at this rate
 * you will hit your goal on ..." projection.
 */
export function trendSlope(points: Point[]): number | null {
  if (points.length < 3) return null;
  const t0 = Date.parse(`${points[0]!.date}T00:00:00`);
  const xs = points.map((p) => (Date.parse(`${p.date}T00:00:00`) - t0) / 86_400_000);
  const ys = points.map((p) => p.value);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - meanX) * (ys[i]! - meanY);
    den += (xs[i]! - meanX) ** 2;
  }
  if (den === 0) return null;
  return num / den;
}

/**
 * Projected date of reaching `targetKg` at the current trend, or null when
 * the trend is flat or heading the wrong way.
 */
export function projectGoalDate(
  points: Point[],
  targetKg: number,
): string | null {
  const slope = trendSlope(points);
  if (slope === null || slope >= -0.0001) return null;
  const last = points[points.length - 1]!;
  const daysNeeded = (last.value - targetKg) / -slope;
  if (!Number.isFinite(daysNeeded) || daysNeeded < 0 || daysNeeded > 3650) {
    return null;
  }
  const d = new Date(Date.parse(`${last.date}T00:00:00`));
  d.setDate(d.getDate() + Math.round(daysNeeded));
  return toDateKey(d);
}

export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayKey(): string {
  return toDateKey(new Date());
}

/**
 * The floor below which intake should not go. Eating under BMR for long
 * stretches costs lean mass and tanks adherence, so the UI warns instead
 * of silently recommending it.
 */
export function minimumIntake(bmrValue: number, sex: Sex): number {
  const absoluteFloor = sex === "male" ? 1500 : 1200;
  return Math.max(absoluteFloor, bmrValue);
}
