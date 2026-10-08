import { describe, expect, it } from "vitest";
import {
  bmi,
  bmiCategory,
  bmr,
  dailyBalance,
  daysBetween,
  exerciseKcal,
  minimumIntake,
  movingAverage,
  pace,
  projectGoalDate,
  sessionKcal,
  tdee,
  toDateKey,
  trendSlope,
} from "./calc.js";

describe("bmr", () => {
  // Mifflin-St Jeor worked by hand:
  // 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780
  it("matches the Mifflin-St Jeor formula for men", () => {
    expect(bmr({ weightKg: 80, heightCm: 180, age: 30, sex: "male" })).toBe(1780);
  });

  // 10*60 + 6.25*160 - 5*30 - 161 = 600 + 1000 - 150 - 161 = 1289
  it("matches the Mifflin-St Jeor formula for women", () => {
    expect(bmr({ weightKg: 60, heightCm: 160, age: 30, sex: "female" })).toBe(
      1289,
    );
  });
});

describe("tdee", () => {
  it("scales BMR by the activity factor", () => {
    const base = bmr({ weightKg: 80, heightCm: 180, age: 30, sex: "male" });
    expect(
      tdee({
        weightKg: 80,
        heightCm: 180,
        age: 30,
        sex: "male",
        activityLevel: "sedentary",
      }),
    ).toBeCloseTo(base * 1.2, 6);
  });

  it("orders the activity levels monotonically", () => {
    const args = { weightKg: 70, heightCm: 170, age: 40, sex: "male" } as const;
    const values = (
      ["sedentary", "light", "moderate", "active", "very_active"] as const
    ).map((activityLevel) => tdee({ ...args, activityLevel }));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeGreaterThan(values[i - 1]!);
    }
  });
});

describe("bmi", () => {
  it("computes kg over metres squared", () => {
    expect(bmi(64.8, 180)).toBeCloseTo(20, 6);
  });

  it("bands at the health-authority boundaries", () => {
    expect(bmiCategory(18.4)).toBe("low");
    expect(bmiCategory(18.5)).toBe("normal");
    expect(bmiCategory(24.9)).toBe("normal");
    expect(bmiCategory(25)).toBe("over");
    expect(bmiCategory(30)).toBe("obese");
  });
});

describe("daysBetween", () => {
  it("counts forward days", () => {
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30);
  });

  it("is negative when the target is in the past", () => {
    expect(daysBetween("2026-03-10", "2026-03-01")).toBe(-9);
  });

  it("crosses a DST boundary without drifting", () => {
    // Rounding rather than flooring is what keeps this at exactly 1 in
    // timezones where the day is 23 or 25 hours long.
    expect(daysBetween("2026-03-08", "2026-03-09")).toBe(1);
  });
});

describe("pace", () => {
  it("derives the daily deficit from the remaining kilos and days", () => {
    const result = pace({
      currentKg: 80,
      targetKg: 75,
      today: "2026-01-01",
      targetDate: "2026-03-02", // 60 days
    });
    expect(result.remainingKg).toBe(5);
    expect(result.daysLeft).toBe(60);
    // 5kg * 7200 kcal / 60 days
    expect(result.requiredDailyDeficit).toBeCloseTo(600, 6);
    expect(result.requiredWeeklyKg).toBeCloseTo(5 / 60 * 7, 6);
  });

  it("flags a plan above 0.75% of bodyweight per week as aggressive", () => {
    const gentle = pace({
      currentKg: 80,
      targetKg: 75,
      today: "2026-01-01",
      targetDate: "2026-04-15",
    });
    expect(gentle.aggressive).toBe(false);

    // 0.8%/week: under the old 1% line and silent, which is how a plan
    // demanding an intake below basal metabolism went unremarked.
    const brisk = pace({
      currentKg: 80,
      targetKg: 74,
      today: "2026-01-01",
      targetDate: "2026-03-08",
    });
    expect(brisk.aggressive).toBe(true);

    const crash = pace({
      currentKg: 80,
      targetKg: 70,
      today: "2026-01-01",
      targetDate: "2026-02-01", // 10kg in 31 days
    });
    expect(crash.aggressive).toBe(true);
  });

  it("reports an overdue target instead of dividing by a negative span", () => {
    const result = pace({
      currentKg: 80,
      targetKg: 75,
      today: "2026-05-01",
      targetDate: "2026-04-01",
    });
    expect(result.overdue).toBe(true);
    expect(Number.isFinite(result.requiredDailyDeficit)).toBe(true);
  });
});

describe("dailyBalance", () => {
  it("counts exercise as offsetting intake", () => {
    const result = dailyBalance({
      tdee: 2200,
      intakeKcal: 2000,
      burnedKcal: 300,
    });
    expect(result.net).toBe(1700);
    expect(result.deficit).toBe(500);
  });

  it("goes negative when the day runs a surplus", () => {
    expect(
      dailyBalance({ tdee: 2000, intakeKcal: 2600, burnedKcal: 0 }).deficit,
    ).toBe(-600);
  });
});

describe("exerciseKcal", () => {
  it("is METs times weight times hours", () => {
    expect(exerciseKcal({ mets: 8, weightKg: 70, minutes: 30 })).toBeCloseTo(
      280,
      6,
    );
  });
});

describe("movingAverage", () => {
  const series = [
    { date: "2026-01-01", value: 80 },
    { date: "2026-01-02", value: 82 },
    { date: "2026-01-03", value: 78 },
  ];

  it("smooths a spike toward the surrounding values", () => {
    const smoothed = movingAverage(series, 3);
    expect(smoothed[1]!.value).toBeCloseTo(80, 6);
  });

  it("keeps the dates and the length", () => {
    const smoothed = movingAverage(series, 7);
    expect(smoothed.map((p) => p.date)).toEqual(series.map((p) => p.date));
  });

  it("handles an empty series", () => {
    expect(movingAverage([], 7)).toEqual([]);
  });

  it("shortens the window at the edges rather than dropping points", () => {
    // The first point averages only itself and its right neighbour.
    expect(movingAverage(series, 3)[0]!.value).toBeCloseTo(81, 6);
  });
});

describe("trendSlope", () => {
  it("returns kg per day for a clean downward line", () => {
    const points = [
      { date: "2026-01-01", value: 80 },
      { date: "2026-01-11", value: 79 },
      { date: "2026-01-21", value: 78 },
    ];
    expect(trendSlope(points)).toBeCloseTo(-0.1, 6);
  });

  it("returns null when there are too few points to fit", () => {
    expect(trendSlope([{ date: "2026-01-01", value: 80 }])).toBeNull();
  });

  it("returns null when every point is on the same day", () => {
    const sameDay = Array.from({ length: 3 }, () => ({
      date: "2026-01-01",
      value: 80,
    }));
    expect(trendSlope(sameDay)).toBeNull();
  });
});

describe("projectGoalDate", () => {
  it("extrapolates the date the trend reaches the target", () => {
    const points = [
      { date: "2026-01-01", value: 80 },
      { date: "2026-01-11", value: 79 },
      { date: "2026-01-21", value: 78 },
    ];
    // Losing 0.1kg/day from 78 needs 30 more days to reach 75.
    expect(projectGoalDate(points, 75)).toBe("2026-02-20");
  });

  it("returns null when the trend is flat or rising", () => {
    const flat = [
      { date: "2026-01-01", value: 80 },
      { date: "2026-01-11", value: 80 },
      { date: "2026-01-21", value: 80 },
    ];
    expect(projectGoalDate(flat, 75)).toBeNull();

    const rising = [
      { date: "2026-01-01", value: 78 },
      { date: "2026-01-11", value: 79 },
      { date: "2026-01-21", value: 80 },
    ];
    expect(projectGoalDate(rising, 75)).toBeNull();
  });

  it("returns null rather than a date decades out", () => {
    const glacial = [
      { date: "2026-01-01", value: 80.0 },
      { date: "2026-01-11", value: 79.999 },
      { date: "2026-01-21", value: 79.998 },
    ];
    expect(projectGoalDate(glacial, 60)).toBeNull();
  });
});

describe("minimumIntake", () => {
  it("never recommends below the absolute floor", () => {
    expect(minimumIntake(1100, "male")).toBe(1500);
    expect(minimumIntake(1000, "female")).toBe(1200);
  });

  it("uses BMR once it exceeds the floor", () => {
    expect(minimumIntake(1800, "male")).toBe(1800);
  });
});

describe("toDateKey", () => {
  it("zero-pads month and day", () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("uses local time, not UTC", () => {
    // 23:30 local must still be that local day, which a toISOString-based
    // implementation would get wrong east of UTC.
    expect(toDateKey(new Date(2026, 6, 15, 23, 30))).toBe("2026-07-15");
  });
});

describe("sessionKcal", () => {
  const w = { kg: 60, source: "latest" as const };

  it("is METs x weight x active hours, labelled as an estimate with its basis", () => {
    const r = sessionKcal({
      items: [{ name: "スクワット", mets: 5, activeSec: 600 }],
      weight: w,
      rpe: 6,
    });
    expect(r.kcal).toBe(50); // 5 * 60 * 1/6
    expect(r.basis).toMatch(/^推定/);
    expect(r.basis).toContain("60kg");
    expect(r.basis).toContain("休憩除く");
    expect(r.missing).toEqual([]);
  });

  it("scales with reported effort and with easing off", () => {
    const items = [{ name: "a", mets: 6, activeSec: 600 }];
    const hard = sessionKcal({ items, weight: w, rpe: 9 }).kcal!;
    const mid = sessionKcal({ items, weight: w, rpe: 6 }).kcal!;
    const easy = sessionKcal({ items, weight: w, rpe: 2 }).kcal!;
    expect(hard).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(easy);
    expect(sessionKcal({ items, weight: w, reduced: true }).basis).toContain("軽め");
  });

  it("says when standard intensity was assumed", () => {
    const r = sessionKcal({ items: [{ name: "a", mets: 6, activeSec: 600 }], weight: w });
    expect(r.basis).toContain("標準強度を仮定");
  });

  it("names the starting weight when no weigh-in exists", () => {
    const r = sessionKcal({
      items: [{ name: "a", mets: 6, activeSec: 600 }],
      weight: { kg: 70, source: "start" },
    });
    expect(r.basis).toContain("開始時の体重");
  });

  it("returns no number, and says what is missing, instead of inventing a weight", () => {
    const r = sessionKcal({ items: [{ name: "a", mets: 6, activeSec: 600 }] });
    expect(r.kcal).toBeNull();
    expect(r.missing).toContain("体重");
    expect(r.basis).toContain("体重");
  });

  it("leaves out an exercise with no METs and flags it", () => {
    const r = sessionKcal({
      items: [
        { name: "a", mets: 6, activeSec: 600 },
        { name: "謎の動き", activeSec: 600 },
      ],
      weight: w,
      rpe: 6,
    });
    expect(r.kcal).toBe(60);
    expect(r.missing.join()).toContain("謎の動き");
    expect(r.basis).toContain("除外");
  });

  it("does not count time that was not spent exercising", () => {
    const r = sessionKcal({ items: [{ name: "a", mets: 6, activeSec: 0 }], weight: w });
    expect(r.kcal).toBeNull();
    expect(r.missing).toContain("運動時間");
  });
});
