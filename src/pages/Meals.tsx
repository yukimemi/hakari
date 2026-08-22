// Meal log for one day, plus the capture flow.

import { useState, useEffect } from "react";
import { useSubView } from "../lib/subview";
import { useUid } from "../auth/context";
import { useMealsOfDay, useSettings, useWorkoutsOfDay } from "../data/hooks";
import { useTargets } from "../data/useTargets";
import { deleteMeal, saveMeal, type StoredMeal, photoUrl } from "../data/store";
import MealItemsEditor from "../components/MealItemsEditor";
import { recalculate, type MealDraft } from "../lib/meal";
import { ApiError } from "../lib/api";
import Scanning from "../components/Scanning";
import MealCapture from "../components/MealCapture";
import DayNav from "../components/DayNav";
import {
  Alert,
  Button,
  Empty,
  Field,
  Panel,
  Reading,
  Select,
} from "../components/ui";
import { formatKcal } from "../lib/format";
import { todayKey } from "../../shared/calc";
import type { MealSlot, TaskAssignment } from "../../shared/schema";

const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: "朝食",
  lunch: "昼食",
  dinner: "夕食",
  snack: "間食",
};

export default function Meals() {
  const uid = useUid();
  const [date, setDate] = useState(todayKey());
  // In the URL, so back closes the capture form rather than leaving the
  // page — and so the dashboard's shortcut is the same thing as pressing
  // 「食事を追加」 here, not a second way in.
  const capture = useSubView("capture");
  const capturing = capture.value === "1";
  // True only when the page was entered with the form already open — the
  // dashboard shortcut, which means "I am about to eat" and should reach
  // the camera in one tap. Pressing 「食事を追加」 here keeps the choice
  // between camera, album and typing.
  const [autoOpen] = useState(capturing);

  const { settings } = useSettings();
  const { data: meals, loading } = useMealsOfDay(date);

  const total = meals.reduce((sum, meal) => sum + meal.totalKcal, 0);
  const macros = meals.reduce(
    (acc, meal) => {
      for (const item of meal.items) {
        acc.protein += item.proteinG;
        acc.fat += item.fatG;
        acc.carbs += item.carbsG;
      }
      return acc;
    },
    { protein: 0, fat: 0, carbs: 0 },
  );

  const targets = useTargets();
  const { data: workouts } = useWorkoutsOfDay(date);

  // Exercise earns room to eat: burning 250kcal and eating 250kcal more
  // lands on the same shortfall. Leaving it out of the budget on the very
  // screen where food is added made the day look tighter than it was.
  const burned = workouts.reduce((sum, w) => sum + w.kcalBurned, 0);

  return (
    <>
      <DayNav date={date} onChange={setDate} />

      <Panel title="合計">
        <Reading label="kcal" value={formatKcal(total)} size="md" />
        <div className="mt-3">
          {targets && (
            <IntakeBar
              intake={total}
              target={targets.targetIntakeKcal}
              burned={burned}
              tdee={targets.tdeeKcal}
            />
          )}

          {targets && (
            <div className="mt-4 space-y-2.5 border-t border-rule/60 pt-3">
              <MacroBar
                label="たんぱく質"
                got={macros.protein}
                target={targets.proteinTargetG}
                direction="floor"
                hint="下回ると筋肉が落ちる"
              />
              <MacroBar
                label="脂質"
                got={macros.fat}
                target={targets.fatTargetG}
                direction="ceiling"
              />
              <MacroBar
                label="炭水化物"
                got={macros.carbs}
                target={targets.carbsTargetG}
                direction="ceiling"
              />
            </div>
          )}
        </div>
      </Panel>

      {capturing ? (
        <MealCapture
          date={date}
          assignment={settings.ai.meal}
          autoOpen={autoOpen}
          onSaved={capture.close}
          onCancel={capture.close}
        />
      ) : (
        <Button variant="primary" size="lg" onClick={() => capture.open("1")}>
          食事を追加
        </Button>
      )}

      {!loading && meals.length === 0 && !capturing && (
        <Empty title="この日の記録はまだありません">
          写真を撮れば料理を見分けてカロリーを出します。
        </Empty>
      )}

      {meals.map((meal) => (
        <MealCard
          key={meal.id}
          meal={meal}
          assignment={settings.ai.meal}
          onDelete={() => deleteMeal(uid, meal.id, meal.photoPath)}
        />
      ))}
    </>
  );
}

function MealCard({
  meal,
  assignment,
  onDelete,
}: {
  meal: StoredMeal;
  assignment: TaskAssignment;
  onDelete: () => void;
}) {
  const uid = useUid();
  const [confirming, setConfirming] = useState(false);
  // Null while not editing. Seeded from the record on entry rather than
  // held in sync with it, so a half-finished correction is not overwritten
  // by the snapshot it came from.
  const [draft, setDraft] = useState<MealDraft[] | null>(null);
  const [slot, setSlot] = useState<MealSlot>(meal.slot);
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);

  // Storage URLs are signed and time-limited, so they are fetched per view
  // rather than stored alongside the record.
  useEffect(() => {
    const path = meal.photoPath;
    if (!path) return;
    let cancelled = false;
    photoUrl(path)
      .then((url) => {
        if (!cancelled) setPhoto(url);
      })
      .catch(() => {
        // A photo that will not load is not worth an error: the numbers
        // are the record, the picture is the receipt.
      });
    return () => {
      cancelled = true;
    };
  }, [meal.photoPath]);

  const startEdit = () => {
    setConfirming(false);
    setSlot(meal.slot);
    setDraft(meal.items.map((item) => ({ ...item })));
  };

  // The photo cannot show how much milk went into the glass, and it can
  // read 納豆 as 煮豆; the person who ate it can correct either. Fix the
  // name or the amount and the numbers behind it are worked out again
  // rather than left stale.
  const recompute = async () => {
    if (!draft?.some((item) => item.name.trim())) return;
    setRecalculating(true);
    setError(null);
    try {
      const { items } = await recalculate(draft, assignment);
      setDraft(items);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "計算し直せませんでした",
      );
    } finally {
      setRecalculating(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const items = draft.filter((item) => item.name.trim());
      // Everything not being edited is carried across verbatim: the photo,
      // where it came from, the date. Dropping them would quietly turn a
      // corrected meal into a different one.
      await saveMeal(
        uid,
        {
          date: meal.date,
          slot,
          // The confidence flag belongs to the photo reading, not to the
          // record it produced; once a human has been through the numbers
          // it means nothing.
          items: items.map((item) => ({
            name: item.name,
            quantity: item.quantity,
            kcal: item.kcal,
            proteinG: item.proteinG,
            fatG: item.fatG,
            carbsG: item.carbsG,
          })),
          totalKcal: items.reduce((sum, item) => sum + item.kcal, 0),
          photoPath: meal.photoPath,
          source: meal.source,
          // Carried across so a correction keeps the meal where it is in
          // the day's list rather than jumping to the top.
          createdAt: meal.createdAt,
        },
        meal.id,
      );
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title={SLOT_LABEL[meal.slot]}
      action={
        draft ? (
          <div className="flex gap-2">
            <Button variant="primary" onClick={save} loading={saving}>
              保存
            </Button>
            <Button onClick={() => setDraft(null)}>やめる</Button>
          </div>
        ) : confirming ? (
          <div className="flex gap-2">
            <Button variant="danger" onClick={onDelete}>
              削除する
            </Button>
            <Button onClick={() => setConfirming(false)}>戻る</Button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="reading text-lg font-semibold">
              {formatKcal(meal.totalKcal)}
              <span className="ml-1 text-xs font-medium text-muted">kcal</span>
            </span>
            <Button onClick={startEdit} className="!px-2">
              編集
            </Button>
            <Button onClick={() => setConfirming(true)} className="!px-2">
              …
            </Button>
          </div>
        )
      }
    >
      {photo && (
        <a
          href={photo}
          target="_blank"
          rel="noreferrer"
          className="mb-3 block overflow-hidden rounded-lg bg-sunk"
        >
          <img
            src={photo}
            alt={`${SLOT_LABEL[meal.slot]}の写真`}
            loading="lazy"
            className="h-40 w-full object-cover"
          />
        </a>
      )}

      {error && <Alert tone="error">{error}</Alert>}

      {draft ? (
        <div className="space-y-3">
          <Field label="どの食事">
            <Select
              value={slot}
              onChange={(e) => setSlot(e.target.value as MealSlot)}
            >
              {Object.entries(SLOT_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <MealItemsEditor items={draft} onChange={setDraft} />

          <Button
            className="w-full"
            onClick={recompute}
            loading={recalculating}
            disabled={!draft.some((item) => item.name.trim())}
          >
            名前と分量から AI で計算し直す
          </Button>
          {recalculating && (
            <Scanning
              variant="panel"
              everySec={3}
              steps={[
                "料理名と分量を読んでいます",
                "カロリーを計算しています",
                "PFC を出しています",
              ]}
            />
          )}

          <div className="flex items-baseline justify-between border-t border-rule/60 pt-3">
            <span className="engraved">合計</span>
            <span className="reading text-2xl font-bold">
              {formatKcal(draft.reduce((sum, item) => sum + item.kcal, 0))}
              <span className="ml-1 text-sm font-medium text-muted">kcal</span>
            </span>
          </div>
        </div>
      ) : (
      <ul className="divide-y divide-rule/60">
        {meal.items.map((item, index) => (
          <li key={index} className="flex items-baseline justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{item.name}</p>
              <p className="truncate text-xs text-muted">
                {item.quantity} · たんぱく質 {Math.round(item.proteinG)}g・脂質{" "}
                {Math.round(item.fatG)}g・炭水化物 {Math.round(item.carbsG)}g
              </p>
            </div>
            <span className="reading shrink-0 text-sm">
              {formatKcal(item.kcal)}
            </span>
          </li>
        ))}
      </ul>
      )}
    </Panel>
  );
}

/** Intake against maintenance. The graduation at TDEE is the line that
 *  matters — under it the day moves toward the goal. */
/** The day on a graduated rail.
 *
 * It was two unlabelled hairlines, which is to say the two numbers that
 * decide the day were drawn as scratches and left to be guessed at. Now
 * each mark carries its name, and the room exercise earned is a band you
 * can see rather than a sum you have to trust.
 *
 *   |=========== eaten ===========|·· earned ··|···· neither ····|
 *                              目標          維持
 *
 * Past 維持 the day gains weight; between the two it merely stops moving
 * toward the goal. Those are different failures and they get different
 * colours.
 */
function IntakeBar({
  intake,
  target,
  burned,
  tdee,
}: {
  intake: number;
  target: number;
  burned: number;
  tdee: number;
}) {
  const budget = target + burned;
  const maintenance = tdee + burned;
  const scale = Math.max(maintenance * 1.12, intake * 1.02);
  const pct = (value: number) => Math.min(100, (value / scale) * 100);

  const over = intake > budget;
  const gaining = intake > maintenance;
  const left = budget - intake;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="engraved">{gaining ? "維持を超過" : over ? "目標を超過" : "あと"}</span>
        <span
          className={`reading text-xl font-semibold ${
            gaining ? "text-needle" : over ? "text-warn" : "text-goal"
          }`}
        >
          {formatKcal(Math.abs(left))}
          <span className="ml-1 text-xs font-medium text-muted">kcal</span>
        </span>
      </div>

      <div className="relative mt-2 h-3 w-full overflow-hidden rounded-full bg-sunk">
        {/* room earned by exercise */}
        {burned > 0 && (
          <div
            className="absolute inset-y-0"
            style={{
              left: `${pct(target)}%`,
              width: `${pct(budget) - pct(target)}%`,
              // Tailwind cannot fold an alpha into a bare var() colour, so
              // the tint is mixed here instead of written as bg-goal/25.
              background: "color-mix(in srgb, var(--goal) 28%, transparent)",
            }}
          />
        )}
        {/* over budget, but not yet gaining */}
        <div
          className="absolute inset-y-0"
          style={{
            left: `${pct(budget)}%`,
            width: `${pct(maintenance) - pct(budget)}%`,
            background: "color-mix(in srgb, var(--warn) 16%, transparent)",
          }}
        />
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ${
            gaining ? "bg-needle" : over ? "bg-warn" : "bg-goal"
          }`}
          style={{ width: `${pct(intake)}%` }}
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-ink"
          style={{ left: `${pct(budget)}%` }}
        />
        <div
          className="absolute inset-y-0 w-px bg-rule-strong"
          style={{ left: `${pct(maintenance)}%` }}
        />
      </div>

      {/* the marks, named */}
      <div className="relative mt-1 h-8">
        <Mark at={pct(budget)} label="目標" value={budget} strong />
        <Mark at={pct(maintenance)} label="維持" value={maintenance} />
      </div>

      {/* The marks show the totals; this says where they came from, in the
          same order and with the same words, so the two cannot be read as
          different numbers. */}
      <p className="mt-1 text-xs leading-relaxed text-muted">
        {burned > 0 ? (
          <>
            目標 {formatKcal(target)}{" "}
            <span className="text-goal">＋ 運動 {formatKcal(burned)}</span> ={" "}
            {formatKcal(budget)} kcal まで。
          </>
        ) : (
          <>目標 {formatKcal(budget)} kcal まで。</>
        )}{" "}
        維持 {formatKcal(maintenance)} kcal を超えると増えます。
      </p>
    </div>
  );
}

/**
 * One macro against its target.
 *
 * The three are not read the same way, so they are not drawn the same way.
 * Protein is a floor — falling short is the failure, and in a deficit it
 * is the failure that costs muscle. Fat and carbohydrate are ceilings:
 * they are what the remaining energy is spent on, and going over is what
 * pushes the day past its budget. Colouring both "short = red" would have
 * told the reader to eat more carbohydrate for the sake of a full bar.
 */
function MacroBar({
  label,
  got,
  target,
  direction,
  hint,
}: {
  label: string;
  got: number;
  target: number;
  direction: "floor" | "ceiling";
  hint?: string;
}) {
  const grams = Math.round(got);
  const share = target > 0 ? grams / target : 0;
  const ok = direction === "floor" ? share >= 0.85 : share <= 1;
  const bad = direction === "floor" ? share < 0.6 : share > 1.15;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted">
          {label}
          {hint && !ok && (
            <span className="ml-1.5 text-[10px] text-warn">{hint}</span>
          )}
        </span>
        <span className="reading tabular-nums">
          <span className={ok ? "text-ink" : bad ? "text-needle" : "text-warn"}>
            {grams}
          </span>
          <span className="text-muted"> / {target} g</span>
        </span>
      </div>
      <div className="relative mt-1 h-1.5 w-full overflow-hidden rounded-full bg-sunk">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            ok ? "bg-goal" : bad ? "bg-needle" : "bg-warn"
          }`}
          style={{ width: `${Math.min(100, share * 100)}%` }}
        />
        {/* the target itself, when the bar has run past it */}
        {share > 1 && (
          <div
            className="absolute inset-y-0 w-px bg-ink"
            style={{ left: `${(1 / share) * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}

/** A named graduation under the rail. Nudged inward at the ends so the
 *  label never hangs off the panel. */
function Mark({
  at,
  label,
  value,
  strong = false,
}: {
  at: number;
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div
      className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
      style={{ left: `${Math.min(94, Math.max(6, at))}%` }}
    >
      <span className={`engraved ${strong ? "text-ink" : "text-muted"}`}>{label}</span>
      <span className="reading text-[10px] text-muted">{formatKcal(value)}</span>
    </div>
  );
}
