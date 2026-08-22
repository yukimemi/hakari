// What was actually done, as opposed to what was planned.
//
// The plan and the record were being kept in the same place but only the
// plan was ever shown: finishing a demonstration wrote a workout that the
// user then had no way to see. A log that cannot be read is not a log.
//
// It also takes entries by hand, because most exercise happens away from
// the phone — a walk, a swim, a gym session — and a diet ledger that only
// counts the sets it choreographed will always be wrong on the burn side.

import { useMemo, useState } from "react";
import { useUid } from "../auth/context";
import { useWorkoutsOfDay } from "../data/hooks";
import { deleteWorkout, saveWorkout } from "../data/store";
import { EXERCISES } from "../../shared/exercises";
import { exerciseKcal } from "../../shared/calc";
import { formatKcal } from "../lib/format";
import { Alert, Button, Field, NumberInput, Panel, Select } from "./ui";

/** Not in the demonstration catalogue, because the avatar cannot show
 *  them — but they are what most days are actually made of. */
const EVERYDAY = [
  { id: "walk", name: "ウォーキング", mets: 3.5 },
  { id: "jog", name: "ジョギング", mets: 7.0 },
  { id: "run", name: "ランニング", mets: 9.8 },
  { id: "bike", name: "自転車", mets: 6.8 },
  { id: "swim", name: "水泳", mets: 7.0 },
  { id: "stairs", name: "階段", mets: 8.0 },
  { id: "housework", name: "家事・掃除", mets: 3.3 },
] as const;

const OPTIONS = [
  ...EVERYDAY.map((e) => ({ id: e.id, name: e.name, mets: e.mets })),
  ...EXERCISES.map((e) => ({ id: e.id, name: e.name, mets: e.mets })),
];

export default function WorkoutLog({
  date,
  weightKg,
}: {
  date: string;
  weightKg: number;
}) {
  const uid = useUid();
  const { data: workouts, loading } = useWorkoutsOfDay(date);

  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState(OPTIONS[0]!.id);
  const [minutes, setMinutes] = useState("30");
  const [kcal, setKcal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = OPTIONS.find((o) => o.id === choice) ?? OPTIONS[0]!;

  // METs × weight × hours. Shown as a suggestion rather than imposed: the
  // user knows whether that walk was a stroll or a march.
  const estimate = useMemo(
    () =>
      Math.round(
        exerciseKcal({
          mets: selected.mets,
          weightKg,
          minutes: Number(minutes) || 0,
        }),
      ),
    [selected, weightKg, minutes],
  );

  const total = workouts.reduce((sum, w) => sum + w.kcalBurned, 0);

  const add = async () => {
    const mins = Number(minutes);
    if (!(mins > 0)) {
      setError("時間を入れてください");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveWorkout(uid, {
        date,
        name: selected.name,
        minutes: mins,
        kcalBurned: Number(kcal) || estimate,
      });
      setAdding(false);
      setMinutes("30");
      setKcal("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="運動の記録"
      action={
        total > 0 ? (
          <span className="reading text-lg font-semibold text-goal">
            {formatKcal(total)}
            <span className="ml-1 text-xs font-medium text-muted">kcal</span>
          </span>
        ) : undefined
      }
    >
      {error && <Alert tone="error">{error}</Alert>}

      {!loading && workouts.length === 0 && !adding && (
        <p className="text-sm text-muted">
          この日の運動はまだ記録がありません。
        </p>
      )}

      {workouts.length > 0 && (
        <ul className="divide-y divide-rule/60">
          {workouts.map((workout) => (
            <li
              key={workout.id}
              className="flex items-baseline justify-between gap-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{workout.name}</p>
                {workout.minutes !== undefined && (
                  <p className="text-xs text-muted">{workout.minutes} 分</p>
                )}
              </div>
              <div className="flex shrink-0 items-baseline gap-3">
                <span className="reading text-sm">
                  {formatKcal(workout.kcalBurned)}
                </span>
                <button
                  type="button"
                  onClick={() => deleteWorkout(uid, workout.id)}
                  className="text-xs text-muted underline"
                >
                  削除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="mt-3 space-y-3">
          <Field label="種目">
            <Select value={choice} onChange={(e) => setChoice(e.target.value)}>
              {OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="時間">
              <NumberInput
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                suffix="分"
                inputMode="numeric"
              />
            </Field>
            <Field label="消費" hint={`目安 ${estimate} kcal`}>
              <NumberInput
                value={kcal}
                onChange={(e) => setKcal(e.target.value)}
                placeholder={String(estimate)}
                suffix="kcal"
                inputMode="numeric"
              />
            </Field>
          </div>

          <div className="flex gap-2">
            <Button variant="primary" onClick={add} loading={busy}>
              記録する
            </Button>
            <Button onClick={() => setAdding(false)}>やめる</Button>
          </div>
        </div>
      ) : (
        <Button className="mt-3 w-full" onClick={() => setAdding(true)}>
          運動を追加
        </Button>
      )}
    </Panel>
  );
}
