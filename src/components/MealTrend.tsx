// The last two weeks of eating, as a chart.
//
// The panel above this one answers "how is today going". This answers the
// question today cannot: whether the days add up. A diet is decided by the
// average over a fortnight, not by any single dinner, so the bar for one
// day is deliberately the quiet element and the 7-day mean is the line the
// eye follows — the same division of labour as the weight screen.
//
// Two things are plotted, because "how much" and "what of" fail
// differently. 1,600 kcal is a good day and 1,600 kcal that is 90% carbs
// on 30g of protein is a day that loses muscle; only the second chart can
// tell them apart.
//
// Bars are clickable: a day that looks wrong is one tap from the meals
// that made it.

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Empty, Panel, Reading } from "./ui";
import { formatKcal, formatSigned } from "../lib/format";
import { useRecentLogs } from "../data/hooks";
import {
  buildMealTrend,
  type MealTrend as MealTrendData,
  type TrendDay,
} from "../lib/mealTrend";

const RANGES = [14, 30] as const;
type Range = (typeof RANGES)[number];

const MACROS = [
  { key: "proteinPct", label: "たんぱく質", colour: "var(--chart-protein)" },
  { key: "fatPct", label: "脂質", colour: "var(--chart-fat)" },
  { key: "carbsPct", label: "炭水化物", colour: "var(--chart-carbs)" },
] as const;

const tooltipStyle = {
  background: "var(--panel)",
  border: "1px solid var(--rule)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--ink)",
} as const;

/** Subscribes to the window and hands the shaped series to the view. Kept
 *  apart from it so the chart can be rendered from fixed data. */
export default function MealTrend({
  targetIntakeKcal,
  onPickDate,
}: {
  /** The line the bars are read against. Absent until the profile is set
   *  up, in which case the chart is still worth showing without it. */
  targetIntakeKcal?: number;
  onPickDate?: (date: string) => void;
}) {
  const [days, setDays] = useState<Range>(14);
  const { byDate, range } = useRecentLogs(days);
  const trend = useMemo(
    () => buildMealTrend(byDate, range.to, days),
    [byDate, range.to, days],
  );

  return (
    <MealTrendView
      trend={trend}
      days={days}
      onDaysChange={setDays}
      targetIntakeKcal={targetIntakeKcal}
      onPickDate={onPickDate}
    />
  );
}

export function MealTrendView({
  trend,
  days,
  onDaysChange,
  targetIntakeKcal,
  onPickDate,
}: {
  trend: MealTrendData;
  days: Range;
  onDaysChange: (days: Range) => void;
  targetIntakeKcal?: number;
  onPickDate?: (date: string) => void;
}) {
  const gap =
    trend.averageKcal !== null && targetIntakeKcal !== undefined
      ? trend.averageKcal - targetIntakeKcal
      : null;

  const pick = (day: TrendDay) => {
    if (day.logged && onPickDate) onPickDate(day.date);
  };

  // Ticks land on round hundreds instead of wherever the tallest bar
  // happens to be, and the target line stays inside the plot even on a
  // fortnight that never reached it.
  const ceiling =
    Math.ceil(
      Math.max(
        targetIntakeKcal ?? 0,
        ...trend.days.map((day) => day.intakeKcal ?? 0),
      ) / 500,
    ) * 500;

  return (
    <Panel
      title="食事の推移"
      action={
        <div className="flex gap-1" role="group" aria-label="表示する期間">
          {RANGES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onDaysChange(option)}
              aria-pressed={days === option}
              className={`rounded-md px-2.5 py-1 text-xs ${
                days === option
                  ? "bg-sunk text-ink border border-rule-strong"
                  : "text-muted border border-transparent"
              }`}
            >
              {option}日
            </button>
          ))}
        </div>
      }
    >
      {trend.loggedDays === 0 ? (
        <Empty title="まだ記録がありません">
          数日ぶん記録すると、平均とPFCのバランスが見えてきます。
        </Empty>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 pb-4">
            <Reading
              label="平均摂取"
              value={formatKcal(trend.averageKcal!)}
              unit="kcal"
              size="sm"
            />
            <Reading
              label="目標との差"
              value={gap === null ? "—" : formatSigned(gap)}
              unit={gap === null ? undefined : "kcal"}
              size="sm"
              tone={gap === null ? "muted" : gap > 0 ? "needle" : "goal"}
            />
            <Reading
              label="記録日数"
              value={`${trend.loggedDays}/${days}`}
              unit="日"
              size="sm"
            />
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={trend.days}
                margin={{ top: 8, right: 12, bottom: 0, left: -6 }}
              >
                <CartesianGrid
                  stroke="var(--rule)"
                  strokeDasharray="2 4"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "var(--muted)" }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--rule)" }}
                  minTickGap={16}
                />
                <YAxis
                  domain={[0, ceiling]}
                  ticks={Array.from(
                    { length: ceiling / 500 + 1 },
                    (_, step) => step * 500,
                  )}
                  tick={{ fontSize: 10, fill: "var(--muted)" }}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickFormatter={(value: number) => formatKcal(value)}
                />
                <Tooltip
                  cursor={{ fill: "var(--rule)", opacity: 0.25 }}
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: "var(--muted)" }}
                  formatter={(value, name) => [
                    `${formatKcal(Number(value))} kcal`,
                    name === "average" ? "7日平均" : "摂取",
                  ]}
                />
                {targetIntakeKcal !== undefined && (
                  // No in-chart label: a fortnight of bars leaves nowhere
                  // for it to sit that is not on top of a day. The number
                  // is in the legend below instead.
                  <ReferenceLine
                    y={targetIntakeKcal}
                    stroke="var(--chart-goal)"
                    strokeDasharray="5 4"
                    strokeWidth={2}
                  />
                )}
                {/* The bars stay the low-contrast series and the mean is
                    the needle, as on the weight screen. A day over budget
                    is not given a colour of its own — it is the bar that
                    crosses the dashed line, and spending the one saturated
                    colour twice in one chart is what makes it stop
                    meaning "reading". */}
                <Bar
                  dataKey="intakeKcal"
                  name="intake"
                  fill="var(--chart-raw)"
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                  cursor={onPickDate ? "pointer" : undefined}
                  onClick={(_, index) => pick(trend.days[index]!)}
                />
                <Line
                  type="monotone"
                  dataKey="averageKcal"
                  name="average"
                  stroke="var(--chart-trend)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--panel)" }}
                  connectNulls
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4 rounded"
                style={{ background: "var(--chart-trend)" }}
              />
              7日平均
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ background: "var(--chart-raw)" }}
              />
              その日の摂取
            </span>
            {targetIntakeKcal !== undefined && (
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-0.5 w-4 rounded"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(to right, var(--chart-goal) 0 5px, transparent 5px 9px)",
                  }}
                />
                目標 {formatKcal(targetIntakeKcal)}
              </span>
            )}
          </div>

          {trend.balance && (
            <div className="mt-5 border-t border-rule/60 pt-4">
              <h3 className="text-xs text-muted">
                PFCバランス（エネルギー比）
              </h3>

              <div className="mt-2 h-32 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={trend.days}
                    margin={{ top: 4, right: 12, bottom: 0, left: -6 }}
                    barCategoryGap="15%"
                  >
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: "var(--muted)" }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--rule)" }}
                      minTickGap={16}
                    />
                    <YAxis
                      domain={[0, 100]}
                      ticks={[0, 50, 100]}
                      tick={{ fontSize: 10, fill: "var(--muted)" }}
                      tickLine={false}
                      axisLine={false}
                      width={52}
                      tickFormatter={(value: number) => `${value}%`}
                    />
                    <Tooltip
                      cursor={{ fill: "var(--rule)", opacity: 0.25 }}
                      contentStyle={tooltipStyle}
                      labelStyle={{ color: "var(--muted)" }}
                      formatter={(value, name) => [
                        `${Math.round(Number(value))}%`,
                        MACROS.find((macro) => macro.key === name)?.label ?? name,
                      ]}
                    />
                    {MACROS.map((macro) => (
                      <Bar
                        key={macro.key}
                        dataKey={macro.key}
                        stackId="pfc"
                        fill={macro.colour}
                        isAnimationActive={false}
                        onClick={(_, index) => pick(trend.days[index]!)}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                {MACROS.map((macro) => (
                  <span key={macro.key} className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{ background: macro.colour }}
                    />
                    {macro.label}{" "}
                    {Math.round(trend.balance![macro.key])}%
                  </span>
                ))}
              </div>
            </div>
          )}

          <p className="mt-3 text-xs text-muted">
            写真からの推定値なので1日ぶんの上下は誤差の範囲です。平均の線で見てください。
          </p>
        </>
      )}
    </Panel>
  );
}
