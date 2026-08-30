// What was actually done, as opposed to what was planned.
//
// The plan and the record were being kept in the same place but only the
// plan was ever shown: finishing a demonstration wrote a workout that the
// user then had no way to see. A log that cannot be read is not a log.
//
// It also takes entries by hand, because most exercise happens away from
// the phone — a walk, a swim, a gym session — and a diet ledger that only
// counts the sets it choreographed will always be wrong on the burn side.
//
// The catalogue below only covers what has a METs constant. A lot of real
// training doesn't — a machine at the gym, a class, a move nobody bothered
// to name consistently — so "その他" drops the METs formula entirely and
// asks the AI to judge kcal burn from the exercise name plus sets/reps.

import { useMemo, useState } from "react";
import { useUid } from "../auth/context";
import { useSettings, useWorkoutsOfDay } from "../data/hooks";
import { deleteWorkout, saveWorkout } from "../data/store";
import { EXERCISES } from "../../shared/exercises";
import { exerciseKcal } from "../../shared/calc";
import { formatKcal } from "../lib/format";
import { api, ApiError } from "../lib/api";
import {
  Alert,
  Button,
  Field,
  NumberInput,
  Panel,
  Select,
  TextInput,
} from "./ui";

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

/** Not a real catalogue id — picking it swaps the METs-driven form for a
 *  free-text one backed by `POST /api/exercise-kcal`. */
const CUSTOM_ID = "__custom__";

export default function WorkoutLog({
  date,
  weightKg,
}: {
  date: string;
  weightKg: number;
}) {
  const uid = useUid();
  const { settings } = useSettings();
  const { data: workouts, loading } = useWorkoutsOfDay(date);

  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState(OPTIONS[0]!.id);
  const [minutes, setMinutes] = useState("30");
  const [customName, setCustomName] = useState("");
  const [sets, setSets] = useState("");
  const [reps, setReps] = useState("");
  const [kcal, setKcal] = useState("");
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isCustom = choice === CUSTOM_ID;
  const selected = OPTIONS.find((o) => o.id === choice) ?? OPTIONS[0]!;

  // METs × weight × hours. Shown as a suggestion rather than imposed: the
  // user knows whether that walk was a stroll or a march. Meaningless for
  // a custom entry, which has no METs constant — the AI estimate stands in
  // for it there instead.
  const estimate = useMemo(
    () =>
      isCustom
        ? 0
        : Math.round(
            exerciseKcal({
              mets: selected.mets,
              weightKg,
              minutes: Number(minutes) || 0,
            }),
          ),
    [isCustom, selected, weightKg, minutes],
  );

  const total = workouts.reduce((sum, w) => sum + w.kcalBurned, 0);

  const estimateWithAi = async () => {
    const name = customName.trim();
    if (!name) {
      setError("種目名を入れてください");
      return;
    }
    setError(null);
    setAiBusy(true);
    setAiNote(null);
    try {
      const res = await api.exerciseKcal({
        assignment: settings.ai.exercise,
        name,
        sets: sets ? Number(sets) : undefined,
        reps: reps.trim() || undefined,
        minutes: minutes && Number(minutes) > 0 ? Number(minutes) : undefined,
        weightKg,
      });
      setKcal(String(Math.round(res.estimate.kcalBurned)));
      setAiNote(res.estimate.reasoning);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "計算に失敗しました");
    } finally {
      setAiBusy(false);
    }
  };

  const add = async () => {
    setError(null);

    if (isCustom) {
      const name = customName.trim();
      if (!name) {
        setError("種目名を入れてください");
        return;
      }
      const kcalValue = Number(kcal);
      if (!(kcalValue > 0)) {
        setError("カロリーを入力するか、AI で計算してください");
        return;
      }
      setBusy(true);
      try {
        await saveWorkout(uid, {
          date,
          name,
          sets: sets ? Number(sets) : undefined,
          reps: reps.trim() || undefined,
          minutes: minutes && Number(minutes) > 0 ? Number(minutes) : undefined,
          kcalBurned: kcalValue,
        });
        setAdding(false);
        setCustomName("");
        setSets("");
        setReps("");
        setMinutes("30");
        setKcal("");
        setAiNote(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "保存に失敗しました");
      } finally {
        setBusy(false);
      }
      return;
    }

    const mins = Number(minutes);
    if (!(mins > 0)) {
      setError("時間を入れてください");
      return;
    }
    setBusy(true);
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
                <p className="text-xs text-muted">
                  {[
                    workout.sets && workout.reps
                      ? `${workout.sets}セット x ${workout.reps}回`
                      : null,
                    workout.minutes !== undefined ? `${workout.minutes} 分` : null,
                  ]
                    .filter(Boolean)
                    .join(" / ") || null}
                </p>
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
            <Select
              value={choice}
              onChange={(e) => {
                const next = e.target.value;
                setChoice(next);
                // `minutes` is shared with the catalog form, where "30" is
                // a real default. Carrying it into a freshly opened custom
                // form would silently feed a duration nobody entered into
                // both the AI estimate and the saved record.
                if (next === CUSTOM_ID) setMinutes("");
              }}
            >
              <option value={CUSTOM_ID}>その他（自由入力）</option>
              {OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Field>

          {isCustom ? (
            <>
              <Field label="種目名">
                <TextInput
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="例: ケーブルフライ"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="セット数">
                  <NumberInput
                    value={sets}
                    onChange={(e) => setSets(e.target.value)}
                    suffix="セット"
                    inputMode="numeric"
                    min={1}
                  />
                </Field>
                <Field label="回数">
                  <TextInput
                    value={reps}
                    onChange={(e) => setReps(e.target.value)}
                    placeholder="例: 12 / 12,10,8"
                  />
                </Field>
              </div>

              <Field label="時間 (任意)">
                <NumberInput
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  suffix="分"
                  inputMode="numeric"
                />
              </Field>

              <Field
                label="消費"
                hint={aiNote ?? "AI で計算するか、わかっていれば直接入力"}
              >
                <div className="flex gap-2">
                  <NumberInput
                    value={kcal}
                    onChange={(e) => {
                      setKcal(e.target.value);
                      setAiNote(null);
                    }}
                    placeholder="kcal"
                    suffix="kcal"
                    inputMode="numeric"
                  />
                  <Button onClick={estimateWithAi} loading={aiBusy}>
                    AI で計算
                  </Button>
                </div>
              </Field>
            </>
          ) : (
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
          )}

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
