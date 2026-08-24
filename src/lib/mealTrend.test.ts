import { describe, expect, it } from "vitest";
import { buildMealTrend, type DayTotals } from "./mealTrend";

function totals(partial: Partial<DayTotals>): DayTotals {
  return {
    intakeKcal: 0,
    burnedKcal: 0,
    proteinG: 0,
    fatG: 0,
    carbsG: 0,
    ...partial,
  };
}

describe("buildMealTrend", () => {
  it("returns the whole window, oldest first, across a month boundary", () => {
    const trend = buildMealTrend(new Map(), "2026-03-02", 3);
    expect(trend.days.map((day) => day.date)).toEqual([
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
    expect(trend.days.map((day) => day.label)).toEqual(["2/28", "3/1", "3/2"]);
  });

  it("leaves an unlogged day empty instead of calling it zero kcal", () => {
    const trend = buildMealTrend(
      new Map([["2026-03-02", totals({ intakeKcal: 1800 })]]),
      "2026-03-02",
      2,
    );
    const [gap, eaten] = trend.days;
    expect(gap!.logged).toBe(false);
    expect(gap!.intakeKcal).toBeUndefined();
    expect(eaten!.intakeKcal).toBe(1800);
    // The gap must not drag the mean toward a day nobody ate.
    expect(trend.loggedDays).toBe(1);
    expect(trend.averageKcal).toBe(1800);
  });

  it("treats a workout-only day as unlogged", () => {
    const trend = buildMealTrend(
      new Map([["2026-03-02", totals({ burnedKcal: 300 })]]),
      "2026-03-02",
      1,
    );
    expect(trend.days[0]!.logged).toBe(false);
    expect(trend.averageKcal).toBeNull();
    expect(trend.balance).toBeNull();
  });

  it("splits macros by energy, not by grams", () => {
    // 100g protein (400) + 40g fat (360) + 60g carbs (240) = 1000 kcal.
    const trend = buildMealTrend(
      new Map([
        [
          "2026-03-02",
          totals({ intakeKcal: 1000, proteinG: 100, fatG: 40, carbsG: 60 }),
        ],
      ]),
      "2026-03-02",
      1,
    );
    const day = trend.days[0]!;
    expect(day.proteinPct).toBeCloseTo(40);
    expect(day.fatPct).toBeCloseTo(36);
    expect(day.carbsPct).toBeCloseTo(24);
    expect(day.proteinPct! + day.fatPct! + day.carbsPct!).toBeCloseTo(100);
    expect(trend.balance).toEqual({
      proteinPct: day.proteinPct,
      fatPct: day.fatPct,
      carbsPct: day.carbsPct,
    });
  });

  it("has no split for a day logged as kcal only", () => {
    const trend = buildMealTrend(
      new Map([["2026-03-02", totals({ intakeKcal: 700 })]]),
      "2026-03-02",
      1,
    );
    expect(trend.days[0]!.proteinPct).toBeUndefined();
    expect(trend.balance).toBeNull();
  });

  it("averages only over logged days, ignoring the gaps between them", () => {
    const trend = buildMealTrend(
      new Map([
        ["2026-03-01", totals({ intakeKcal: 1000 })],
        ["2026-03-03", totals({ intakeKcal: 2000 })],
      ]),
      "2026-03-03",
      3,
    );
    const [first, gap, last] = trend.days;
    expect(first!.averageKcal).toBe(1500);
    expect(gap!.averageKcal).toBeUndefined();
    expect(last!.averageKcal).toBe(1500);
    expect(trend.averageKcal).toBe(1500);
  });

  it("keeps the mean to a calendar week, not the seven nearest entries", () => {
    // Logged every fourth day: nothing else falls inside ±3 days, so each
    // day's "7日平均" is its own intake. An index-based window would blend
    // days three weeks apart and still call the line 7日平均.
    const trend = buildMealTrend(
      new Map([
        ["2026-03-01", totals({ intakeKcal: 1000 })],
        ["2026-03-05", totals({ intakeKcal: 2000 })],
        ["2026-03-09", totals({ intakeKcal: 3000 })],
      ]),
      "2026-03-09",
      9,
    );
    const means = trend.days
      .filter((day) => day.logged)
      .map((day) => day.averageKcal);
    expect(means).toEqual([1000, 2000, 3000]);
    // The headline figure is still the whole window's mean.
    expect(trend.averageKcal).toBe(2000);
  });

  it("includes every logged day within three days of the one plotted", () => {
    const trend = buildMealTrend(
      new Map([
        ["2026-03-01", totals({ intakeKcal: 1000 })],
        ["2026-03-04", totals({ intakeKcal: 1600 })],
        ["2026-03-08", totals({ intakeKcal: 2200 })],
      ]),
      "2026-03-08",
      8,
    );
    const byDate = new Map(trend.days.map((day) => [day.date, day]));
    // 3/1 sees 3/4 (three days out) but not 3/8.
    expect(byDate.get("2026-03-01")!.averageKcal).toBe(1300);
    // 3/4 sees 3/1, and 3/8 is four days out.
    expect(byDate.get("2026-03-04")!.averageKcal).toBe(1300);
    // 3/8 sees only 3/8 — 3/4 is four days out.
    expect(byDate.get("2026-03-08")!.averageKcal).toBe(2200);
  });

  it("weights the window balance by the days that ate more", () => {
    const trend = buildMealTrend(
      new Map([
        ["2026-03-01", totals({ intakeKcal: 400, proteinG: 100 })],
        ["2026-03-02", totals({ intakeKcal: 900, fatG: 100 })],
      ]),
      "2026-03-02",
      2,
    );
    // 400 kcal of protein against 900 of fat.
    expect(trend.balance!.proteinPct).toBeCloseTo((400 / 1300) * 100);
    expect(trend.balance!.fatPct).toBeCloseTo((900 / 1300) * 100);
    expect(trend.balance!.carbsPct).toBe(0);
  });
});
