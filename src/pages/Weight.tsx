// Weight log and trend.
//
// The chart shows two series against one axis: the raw daily reading (low
// contrast dots — the noise) and the 7-day trend (the line that actually
// answers "am I losing weight"). The goal is a labelled reference line,
// not a third series. The log table below doubles as the accessible view
// of the same numbers.

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useSubView } from "../lib/subview";
import { useUid } from "../auth/context";
import { useUserDoc, useWeights } from "../data/hooks";
import { deleteWeight, saveWeight } from "../data/store";
import {
  Alert,
  Button,
  Empty,
  Field,
  NumberInput,
  Panel,
  Reading,
  TextInput,
} from "../components/ui";
import { formatKg } from "../lib/format";
import type { WeightEntry } from "../../shared/schema";
import { movingAverage, projectGoalDate, todayKey } from "../../shared/calc";

export default function Weight() {
  const uid = useUid();
  const { data: user } = useUserDoc();
  const { data: weights, loading } = useWeights();
  // In the URL like the other sub-views, so back closes the form and the
  // dashboard's shortcut does not leave `?log=1` behind once it is done.
  const log = useSubView("log");
  const logging = log.value === "1";
  const [editing, setEditing] = useState<WeightEntry | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const goal = user.goal!;

  const chart = useMemo(() => {
    const raw = weights.map((w) => ({ date: w.date, value: w.weightKg }));
    const trend = movingAverage(raw, 7);
    const trendByDate = new Map(trend.map((t) => [t.date, t.value]));
    return raw.map((point) => ({
      date: point.date,
      raw: point.value,
      trend: trendByDate.get(point.date),
      label: point.date.slice(5).replace("-", "/"),
    }));
  }, [weights]);

  const trendSeries = useMemo(
    () => movingAverage(weights.map((w) => ({ date: w.date, value: w.weightKg })), 7),
    [weights],
  );
  const projected = projectGoalDate(trendSeries, goal.targetWeightKg);

  const latest = weights.at(-1);
  const first = weights.at(0);
  const changed = latest && first ? latest.weightKg - first.weightKg : 0;

  return (
    <>
      <Panel title="推移">
        {weights.length === 0 ? (
          <Empty title="まだ記録がありません">
            朝、起きてトイレを済ませた直後に測ると数値が安定します。
          </Empty>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 pb-4">
              <Reading
                label="最新"
                value={latest ? formatKg(latest.weightKg) : "—"}
                unit="kg"
                size="sm"
              />
              <Reading
                label="開始から"
                value={`${changed > 0 ? "+" : changed < 0 ? "−" : "±"}${Math.abs(changed).toFixed(1)}`}
                unit="kg"
                size="sm"
                tone={changed < 0 ? "goal" : changed > 0 ? "needle" : "muted"}
              />
              <Reading
                label="記録日数"
                value={weights.length}
                unit="日"
                size="sm"
              />
            </div>

            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chart}
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
                    domain={["dataMin - 1", "dataMax + 1"]}
                    tick={{ fontSize: 10, fill: "var(--muted)" }}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                    tickFormatter={(v: number) => v.toFixed(0)}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--panel)",
                      border: "1px solid var(--rule)",
                      borderRadius: 10,
                      fontSize: 12,
                      color: "var(--ink)",
                    }}
                    labelStyle={{ color: "var(--muted)" }}
                    formatter={(value, name) => [
                      `${Number(value).toFixed(1)} kg`,
                      name === "trend" ? "7日平均" : "実測",
                    ]}
                  />
                  <ReferenceLine
                    y={goal.targetWeightKg}
                    stroke="var(--chart-goal)"
                    strokeDasharray="5 4"
                    strokeWidth={2}
                    label={{
                      value: `目標 ${formatKg(goal.targetWeightKg)}kg`,
                      position: "insideTopRight",
                      fill: "var(--chart-goal)",
                      fontSize: 10,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="raw"
                    stroke="var(--chart-raw)"
                    strokeWidth={0}
                    dot={{ r: 2.5, fill: "var(--chart-raw)", strokeWidth: 0 }}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                    name="raw"
                  />
                  <Line
                    type="monotone"
                    dataKey="trend"
                    stroke="var(--chart-trend)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--panel)" }}
                    connectNulls
                    name="trend"
                  />
                </LineChart>
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
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: "var(--chart-raw)" }}
                />
                実測
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-0.5 w-4 rounded"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(to right, var(--chart-goal) 0 5px, transparent 5px 9px)",
                  }}
                />
                目標
              </span>
            </div>

            {projected && (
              <p className="mt-3 text-sm text-muted">
                今のペースなら <strong className="reading text-ink">{projected}</strong>{" "}
                ごろに目標到達。
              </p>
            )}
          </>
        )}
      </Panel>

      {logging || editing ? (
        <WeightForm
          // Keyed so switching straight from one record to another
          // refills the fields instead of keeping the first one's.
          key={editing?.date ?? "new"}
          entry={editing ?? undefined}
          onDone={() => {
            if (logging) log.close();
            setEditing(null);
          }}
          onSave={async (next) => {
            // The date is the document id, so moving a record is a write
            // and a delete rather than an update. Refusing to land on a
            // day that already has a reading is the point: silently
            // overwriting one measurement with another loses a number
            // nobody can go back and take again.
            if (editing && next.date !== editing.date) {
              if (weights.some((w) => w.date === next.date)) {
                throw new Error(`${next.date} にはすでに記録があります`);
              }
              await saveWeight(uid, next);
              await deleteWeight(uid, editing.date);
              return;
            }
            await saveWeight(uid, next);
          }}
        />
      ) : (
        <Button variant="primary" size="lg" onClick={() => log.open("1")}>
          今日の体重を記録
        </Button>
      )}

      {!loading && weights.length > 0 && (
        <Panel title="記録">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="pb-2 font-normal text-xs">日付</th>
                <th className="pb-2 font-normal text-xs">体重</th>
                <th className="pb-2 font-normal text-xs">体脂肪</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-rule/60">
              {[...weights].reverse().map((entry) => (
                <tr key={entry.date}>
                  <td className="py-2 reading">{entry.date.slice(5)}</td>
                  <td className="py-2 reading font-semibold">
                    {formatKg(entry.weightKg)}
                    <span className="ml-0.5 text-xs font-normal text-muted">kg</span>
                  </td>
                  <td className="py-2 reading text-muted">
                    {entry.bodyFatPct ? `${entry.bodyFatPct.toFixed(1)}%` : "—"}
                  </td>
                  <td className="py-2 text-right">
                    {confirming === entry.date ? (
                      <span className="flex justify-end gap-2">
                        <button
                          onClick={() => deleteWeight(uid, entry.date)}
                          className="text-xs font-semibold text-needle"
                        >
                          消す
                        </button>
                        <button
                          onClick={() => setConfirming(null)}
                          className="text-xs text-muted"
                        >
                          やめる
                        </button>
                      </span>
                    ) : (
                      <span className="flex justify-end gap-3">
                        <button
                          onClick={() => setEditing(entry)}
                          className="text-xs text-muted hover:text-ink"
                          aria-label={`${entry.date} の記録を直す`}
                        >
                          編集
                        </button>
                        {/* Two steps, because it now sits next to a
                            button people mean to press. */}
                        <button
                          onClick={() => setConfirming(entry.date)}
                          className="text-xs text-muted hover:text-needle"
                          aria-label={`${entry.date} の記録を削除`}
                        >
                          削除
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}

function WeightForm({
  entry,
  onSave,
  onDone,
}: {
  /** The record being corrected, or nothing when adding one. */
  entry?: WeightEntry;
  onSave: (entry: {
    date: string;
    weightKg: number;
    bodyFatPct?: number;
    note?: string;
  }) => Promise<void>;
  onDone: () => void;
}) {
  const [date, setDate] = useState(entry?.date ?? todayKey());
  const [weightKg, setWeightKg] = useState(entry ? String(entry.weightKg) : "");
  const [bodyFatPct, setBodyFatPct] = useState(
    entry?.bodyFatPct === undefined ? "" : String(entry.bodyFatPct),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const w = Number(weightKg);
    if (!w) {
      setError("体重を入力してください");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({
        date,
        weightKg: w,
        bodyFatPct: bodyFatPct ? Number(bodyFatPct) : undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
      setBusy(false);
    }
  };

  return (
    <Panel
      title={entry ? "体重を直す" : "体重を記録"}
      action={
        <Button onClick={onDone} className="text-muted">
          やめる
        </Button>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="体重">
            <NumberInput
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              step="0.1"
              suffix="kg"
              placeholder="78.0"
              autoFocus
            />
          </Field>
          <Field label="体脂肪率" hint="任意">
            <NumberInput
              value={bodyFatPct}
              onChange={(e) => setBodyFatPct(e.target.value)}
              step="0.1"
              suffix="%"
              placeholder="24.0"
            />
          </Field>
        </div>
        <Field
          label="日付"
          hint={entry ? "変えると、その日の記録として移ります" : undefined}
        >
          <TextInput
            type="date"
            value={date}
            max={todayKey()}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" variant="primary" size="lg" loading={busy}>
          {entry ? "保存する" : "記録する"}
        </Button>
      </form>
    </Panel>
  );
}
