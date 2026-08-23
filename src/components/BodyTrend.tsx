// Body composition across photos.
//
// The flipbook next door shows the change; this shows whether it is
// moving in the right direction, in numbers you can read at a glance.
//
// Two series, two axes, and both come from the model rather than from
// measurement. That is deliberate: the pose landmarks the photo step does
// measure are joint centres, so they describe a skeleton and barely budge
// as fat comes off — charting them would draw a flat line and call it a
// plateau.
//
// Waist is the circumference in cm, not `shape.waist`. `shape.waist` is an
// offset against the average for a given height and weight, so someone who
// loses 10kg while staying the same proportions keeps the same value — a
// flat line while the waist is visibly shrinking. Only an absolute number
// can be read as "smaller than last month".
//
// Both numbers are estimates from a photo, with real spread: two analyses
// of the same body on the same day have come back 3 points apart on body
// fat. Three guards against over-reading a single step: the caption says
// so, "開始から" sits next to "前回から" so one wobble is visible against
// the longer run, and the weight that would tempt a spurious correlation
// is left on the weight screen where it has a proper chart.
//
// The waist estimate is also not independent of the weight log, which is
// worth knowing before reading a drop as belly fat: submitting the same
// photo with the recorded weight changed from 86.3kg to 70kg moved the
// answer from 103cm to 90cm on deepseek's vision model. Instructing the
// model in the system prompt not to back-calculate from BMI did not stop
// it. Hence the second caption paragraph — a number that moves with the
// weight you typed cannot corroborate the weight you typed.

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
import type { BodyPhotoRecord } from "../data/store";

/** Signed, with a typographic minus so it lines up with the other
 *  readings on the screen rather than shifting by a hyphen's width. */
function signed(value: number, digits = 1): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

/** Down is progress for both series here, so one comparator serves both.
 *  Equal values are muted rather than green — nothing moved. */
function trendTone(latest: number, before: number): "goal" | "needle" | "muted" {
  if (latest < before) return "goal";
  if (latest > before) return "needle";
  return "muted";
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
          // Absent on analyses stored before the field existed. Left
          // undefined so the line starts where the data does instead of
          // dropping to zero.
          waist: photo.analysis!.estimatedWaistCm,
        })),
    [photos],
  );

  // Every waist reading, in order. The waist line is younger than the
  // history, so its "前回" is the previous photo that has one — not
  // necessarily the previous photo.
  const waists = useMemo(
    () =>
      points
        .map((point) => point.waist)
        .filter((value): value is number => typeof value === "number"),
    [points],
  );

  if (points.length === 0) {
    return (
      <Panel title="体型の推移">
        <Empty title="まだ比べられません">
          写真を解析すると、そのときの推定ウエストと推定体脂肪率が記録されます。
          2枚目からここに推移が出ます。
        </Empty>
      </Panel>
    );
  }

  const fatLatest = points.at(-1)!.fat;
  const fatPrevious = points.at(-2)?.fat;
  const fatFirst = points[0]!.fat;
  const waistLatest = waists.at(-1);
  const waistPrevious = waists.at(-2);
  const waistFirst = waists[0];

  return (
    <Panel title="体型の推移">
      <div className="grid grid-cols-3 gap-2 pb-3">
        <Reading
          label="推定ウエスト"
          value={waistLatest === undefined ? "—" : waistLatest.toFixed(1)}
          unit={waistLatest === undefined ? undefined : "cm"}
          size="sm"
        />
        <Reading
          label="前回から"
          value={
            waistLatest === undefined || waistPrevious === undefined
              ? "—"
              : signed(waistLatest - waistPrevious)
          }
          unit={
            waistLatest === undefined || waistPrevious === undefined
              ? undefined
              : "cm"
          }
          size="sm"
          tone={
            waistLatest === undefined || waistPrevious === undefined
              ? "muted"
              : trendTone(waistLatest, waistPrevious)
          }
        />
        <Reading
          label="開始から"
          value={
            waistLatest === undefined ||
            waistFirst === undefined ||
            waists.length < 2
              ? "—"
              : signed(waistLatest - waistFirst)
          }
          unit={waists.length < 2 ? undefined : "cm"}
          size="sm"
          tone={
            waistLatest === undefined ||
            waistFirst === undefined ||
            waists.length < 2
              ? "muted"
              : trendTone(waistLatest, waistFirst)
          }
        />
      </div>

      <div className="grid grid-cols-3 gap-2 pb-4">
        <Reading
          label="推定体脂肪率"
          value={fatLatest.toFixed(1)}
          unit="%"
          size="sm"
        />
        <Reading
          label="前回から"
          value={fatPrevious === undefined ? "—" : signed(fatLatest - fatPrevious)}
          unit={fatPrevious === undefined ? undefined : "pt"}
          size="sm"
          tone={
            fatPrevious === undefined ? "muted" : trendTone(fatLatest, fatPrevious)
          }
        />
        <Reading
          label="開始から"
          value={points.length < 2 ? "—" : signed(fatLatest - fatFirst)}
          unit={points.length < 2 ? undefined : "pt"}
          size="sm"
          tone={points.length < 2 ? "muted" : trendTone(fatLatest, fatFirst)}
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
              {waists.length > 0 && (
                <YAxis
                  yAxisId="waist"
                  orientation="right"
                  domain={["dataMin - 2", "dataMax + 2"]}
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
                  name === "waist"
                    ? [`${Number(value).toFixed(1)} cm`, "推定ウエスト"]
                    : [`${Number(value).toFixed(1)} %`, "推定体脂肪率"]
                }
              />
              <Line
                yAxisId="fat"
                type="monotone"
                dataKey="fat"
                stroke="var(--chart-raw)"
                strokeWidth={1.5}
                dot={{ r: 2, fill: "var(--chart-raw)", strokeWidth: 0 }}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
              {waists.length > 0 && (
                <Line
                  yAxisId="waist"
                  type="monotone"
                  dataKey="waist"
                  stroke="var(--chart-trend)"
                  strokeWidth={2}
                  dot={{ r: 2.5, fill: "var(--chart-trend)", strokeWidth: 0 }}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Describes the chart, so it only appears when there is one — and
          only names the waist line when that line is actually drawn. */}
      {points.length > 1 && (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          {waists.length > 0 ? (
            <>
              赤い線が<strong className="text-ink">推定ウエスト</strong>
              、灰色が推定体脂肪率です。どちらも写真からの AI 推定なので、
            </>
          ) : (
            <>
              灰色の線が<strong className="text-ink">推定体脂肪率</strong>
              です。写真からの AI 推定なので、
            </>
          )}
          1回ぶんの上下は誤差の範囲です。見るのは
          <strong className="text-ink">向き</strong>で、
          同じ場所・同じ明るさ・同じ服で撮るほど当てになります。
        </p>
      )}
      {waists.length > 0 && (
        <p className="mt-2 text-xs leading-relaxed text-muted">
          推定ウエストはメジャーで測った寸法とは一致しません。写真だけでなく
          <strong className="text-ink">記録した体重にも引っぱられます</strong>。
          同じ写真で体重の記録だけを変えると推定ウエストも動くので、体重とは
          独立した証拠として読まないでください。実寸を知りたいときはメジャーが
          確実です。
        </p>
      )}
      {waists.length === 0 && (
        <p className="mt-2 text-xs leading-relaxed text-muted">
          ウエストの推定は今より前の解析には入っていないので、次に撮った写真から
          記録されます。
        </p>
      )}
    </Panel>
  );
}
