// Body composition across photos.
//
// The flipbook next door shows the change; this shows whether it is
// moving in the right direction, in numbers you can read at a glance.
//
// What is plotted is deliberately not the measurement ratios. Those come
// from pose landmarks — joint centres — so they describe a skeleton and
// barely budge as fat comes off; charting them would draw a flat line and
// call it a plateau. The body-fat read from the analysis does move, and
// the weight recorded beside each photo gives it context.
//
// A photo-derived body-fat number is an estimate with real spread, so a
// single step is inside the noise. Two guards against over-reading it:
// the caption says so outright, and "開始から" is shown next to "前回から"
// so a one-shot wobble is visible against the longer run.

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Empty, Panel, Reading } from "./ui";
import { formatKg } from "../lib/format";
import type { BodyPhotoRecord } from "../data/store";

/** Signed, with a typographic minus so it lines up with the other
 *  readings on the screen rather than shifting by a hyphen's width. */
function signed(value: number, digits = 1): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

export default function BodyTrend({ photos }: { photos: BodyPhotoRecord[] }) {
  // `watchBodyPhotos` orders by date, then by upload time within a day,
  // so this is already chronological — oldest first is what both the
  // chart and the deltas below want. Two photos on one day are ordered by
  // when they were taken, not by document id, which is what keeps
  // "前回から" from reading backwards.
  const points = useMemo(
    () =>
      photos
        .filter((photo) => photo.analysis)
        .map((photo) => ({
          label: photo.date.slice(5).replace("-", "/"),
          fat: photo.analysis!.estimatedBodyFatPct,
          kg: photo.weightKg,
        })),
    [photos],
  );

  if (points.length === 0) {
    return (
      <Panel title="体型の推移">
        <Empty title="まだ比べられません">
          写真を解析すると、そのときの推定体脂肪率が記録されます。
          2枚目からここに推移が出ます。
        </Empty>
      </Panel>
    );
  }

  const latest = points.at(-1)!;
  const previous = points.at(-2);
  const first = points[0]!;
  const hasWeight = points.some((point) => point.kg !== undefined);

  return (
    <Panel title="体型の推移">
      <div className="grid grid-cols-3 gap-2 pb-4">
        <Reading
          label="最新の推定体脂肪率"
          value={latest.fat.toFixed(1)}
          unit="%"
          size="sm"
        />
        <Reading
          label="前回から"
          value={previous ? signed(latest.fat - previous.fat) : "—"}
          unit={previous ? "pt" : undefined}
          size="sm"
          tone={
            !previous
              ? "muted"
              : latest.fat < previous.fat
                ? "goal"
                : latest.fat > previous.fat
                  ? "needle"
                  : "muted"
          }
        />
        <Reading
          label="開始から"
          value={points.length > 1 ? signed(latest.fat - first.fat) : "—"}
          unit={points.length > 1 ? "pt" : undefined}
          size="sm"
          tone={
            points.length < 2
              ? "muted"
              : latest.fat < first.fat
                ? "goal"
                : latest.fat > first.fat
                  ? "needle"
                  : "muted"
          }
        />
      </div>

      {points.length < 2 ? (
        <p className="text-xs leading-relaxed text-muted">
          記録は1枚だけです。次に撮ったときから、ここに線が引かれます。
        </p>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={points}
              margin={{ top: 8, right: 12, bottom: 0, left: -18 }}
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
                minTickGap={24}
              />
              <YAxis
                yAxisId="fat"
                domain={["dataMin - 2", "dataMax + 2"]}
                tick={{ fontSize: 10, fill: "var(--muted)" }}
                tickLine={false}
                axisLine={false}
                width={44}
                tickFormatter={(v: number) => v.toFixed(0)}
              />
              {hasWeight && (
                <YAxis
                  yAxisId="kg"
                  orientation="right"
                  domain={["dataMin - 1", "dataMax + 1"]}
                  tick={{ fontSize: 10, fill: "var(--muted)" }}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  tickFormatter={(v: number) => v.toFixed(0)}
                />
              )}
              <Tooltip
                contentStyle={{
                  background: "var(--panel)",
                  border: "1px solid var(--rule)",
                  borderRadius: 10,
                  fontSize: 12,
                  color: "var(--ink)",
                }}
                labelStyle={{ color: "var(--muted)" }}
                formatter={(value, name) =>
                  name === "kg"
                    ? [`${formatKg(Number(value))} kg`, "体重"]
                    : [`${Number(value).toFixed(1)} %`, "推定体脂肪率"]
                }
              />
              {hasWeight && (
                <Line
                  yAxisId="kg"
                  type="monotone"
                  dataKey="kg"
                  stroke="var(--chart-raw)"
                  strokeWidth={1.5}
                  dot={{ r: 2, fill: "var(--chart-raw)", strokeWidth: 0 }}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                  connectNulls
                />
              )}
              <Line
                yAxisId="fat"
                type="monotone"
                dataKey="fat"
                stroke="var(--chart-trend)"
                strokeWidth={2}
                dot={{ r: 2.5, fill: "var(--chart-trend)", strokeWidth: 0 }}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="mt-3 text-xs leading-relaxed text-muted">
        赤い線が<strong className="text-ink">推定体脂肪率</strong>
        {hasWeight && "、灰色が同じ日の体重"}です。体脂肪率は写真からの
        AI 推定なので、1回ぶんの上下は誤差の範囲です。見るのは
        <strong className="text-ink">向き</strong>で、
        同じ場所・同じ明るさ・同じ服で撮るほど当てになります。
      </p>
    </Panel>
  );
}
