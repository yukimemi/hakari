// Daily meal totals shaped for the chart on the meals screen.
//
// Pure so the arithmetic can be tested without Firestore or a DOM. The
// component only maps this onto recharts.
//
// Two decisions live here rather than in the chart:
//
// - A day with no meal logged is a *gap*, not a zero. Drawing it as 0 kcal
//   claims the day was fasted, and it drags the average toward a number
//   nobody ate. Unlogged days carry `undefined` and are skipped by both
//   the bars and the mean.
// - The PFC split is plotted as a share of *energy*, not grams. 60g of
//   carbohydrate and 60g of fat are the same bar height and not the same
//   day; at 4/9/4 kcal per gram they are not.

import { toDateKey } from "../../shared/calc";

export const KCAL_PER_G = { protein: 4, fat: 9, carbs: 4 } as const;

/** The per-day row `useRecentLogs` accumulates. */
export type DayTotals = {
  intakeKcal: number;
  burnedKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
};

export type TrendDay = {
  date: string;
  /** `M/D`, which is all an axis tick has room for. */
  label: string;
  logged: boolean;
  /** Undefined on an unlogged day, so recharts leaves a gap. */
  intakeKcal?: number;
  burnedKcal?: number;
  proteinG?: number;
  fatG?: number;
  carbsG?: number;
  /** Share of the day's macro energy, 0–100. Undefined when the day has
   *  no macros — a manually typed kcal figure need not carry any. */
  proteinPct?: number;
  fatPct?: number;
  carbsPct?: number;
  /** Centred 7-day mean of intake over logged days only. */
  averageKcal?: number;
};

export type MealTrend = {
  days: TrendDay[];
  loggedDays: number;
  /** Mean intake across logged days, or null when nothing is logged. */
  averageKcal: number | null;
  /** Energy split across the whole window, or null when no macros. */
  balance: { proteinPct: number; fatPct: number; carbsPct: number } | null;
};

/** `yyyy-MM-dd` parsed as a *local* date. `new Date("2026-08-24")` is
 *  parsed as UTC midnight, which lands on the previous day west of
 *  Greenwich once `toDateKey` reads the local parts back out. */
function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function share(day: {
  proteinG: number;
  fatG: number;
  carbsG: number;
}): { proteinPct: number; fatPct: number; carbsPct: number } | null {
  const protein = day.proteinG * KCAL_PER_G.protein;
  const fat = day.fatG * KCAL_PER_G.fat;
  const carbs = day.carbsG * KCAL_PER_G.carbs;
  const total = protein + fat + carbs;
  if (total <= 0) return null;
  return {
    proteinPct: (protein / total) * 100,
    fatPct: (fat / total) * 100,
    carbsPct: (carbs / total) * 100,
  };
}

/**
 * `days` consecutive rows ending on `to` inclusive, oldest first, with the
 * unlogged days present but empty so the axis keeps its calendar spacing.
 */
export function buildMealTrend(
  byDate: Map<string, DayTotals>,
  to: string,
  days: number,
): MealTrend {
  const end = parseDateKey(to);
  const rows: TrendDay[] = [];

  for (let back = days - 1; back >= 0; back--) {
    const at = new Date(end);
    at.setDate(end.getDate() - back);
    const date = toDateKey(at);
    const totals = byDate.get(date);
    const logged = (totals?.intakeKcal ?? 0) > 0;
    const row: TrendDay = {
      date,
      label: `${at.getMonth() + 1}/${at.getDate()}`,
      logged,
    };
    if (logged && totals) {
      row.intakeKcal = totals.intakeKcal;
      row.burnedKcal = totals.burnedKcal;
      row.proteinG = totals.proteinG;
      row.fatG = totals.fatG;
      row.carbsG = totals.carbsG;
      Object.assign(row, share(totals) ?? {});
    }
    rows.push(row);
  }

  const logged = rows.filter((row) => row.logged);
  // A *calendar* window, not the seven nearest entries. `rows` already
  // has one slot per day, so ±3 slots is ±3 days whatever the gaps look
  // like; averaging the logged days inside it is what makes the label
  // "7日平均" true when someone logs every third day. Unlogged days are
  // left out of the sum rather than counted as zero — that would report
  // a deficit that was really a gap in the record.
  const HALF = 3;
  for (let at = 0; at < rows.length; at++) {
    const row = rows[at]!;
    if (!row.logged) continue;
    let sum = 0;
    let seen = 0;
    for (
      let k = Math.max(0, at - HALF);
      k <= Math.min(rows.length - 1, at + HALF);
      k++
    ) {
      const near = rows[k]!;
      if (!near.logged) continue;
      sum += near.intakeKcal!;
      seen++;
    }
    row.averageKcal = sum / seen;
  }

  const totals = logged.reduce(
    (acc, row) => {
      acc.proteinG += row.proteinG ?? 0;
      acc.fatG += row.fatG ?? 0;
      acc.carbsG += row.carbsG ?? 0;
      acc.intakeKcal += row.intakeKcal ?? 0;
      return acc;
    },
    { proteinG: 0, fatG: 0, carbsG: 0, intakeKcal: 0 },
  );

  return {
    days: rows,
    loggedDays: logged.length,
    averageKcal: logged.length ? totals.intakeKcal / logged.length : null,
    balance: share(totals),
  };
}
