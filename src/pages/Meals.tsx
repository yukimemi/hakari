// Meal log for one day, plus the capture flow.

import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useUid } from "../auth/context";
import { useMealsOfDay, useSettings, useWorkoutsOfDay } from "../data/hooks";
import { useTargets } from "../data/useTargets";
import { deleteMeal, type StoredMeal, photoUrl } from "../data/store";
import MealCapture from "../components/MealCapture";
import DayNav from "../components/DayNav";
import {
  Button,
  Empty,
  Panel,
  Reading,
} from "../components/ui";
import { formatKcal } from "../lib/format";
import { todayKey } from "../../shared/calc";
import type { MealSlot } from "../../shared/schema";

const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: "朝食",
  lunch: "昼食",
  dinner: "夕食",
  snack: "間食",
};

export default function Meals() {
  const uid = useUid();
  const [params, setParams] = useSearchParams();
  const [date, setDate] = useState(todayKey());
  const [capturing, setCapturing] = useState(params.get("capture") === "1");

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

  const closeCapture = () => {
    setCapturing(false);
    if (params.has("capture")) {
      params.delete("capture");
      setParams(params, { replace: true });
    }
  };

  return (
    <>
      <DayNav date={date} onChange={setDate} />

      <Panel title="合計">
        <div className="grid grid-cols-4 gap-2">
          <Reading label="kcal" value={formatKcal(total)} size="md" />
          <Reading
            label="たんぱく質"
            value={Math.round(macros.protein)}
            unit="g"
            size="sm"
          />
          <Reading label="脂質" value={Math.round(macros.fat)} unit="g" size="sm" />
          <Reading
            label="炭水化物"
            value={Math.round(macros.carbs)}
            unit="g"
            size="sm"
          />
        </div>
        <div className="mt-3">
          {targets && (
            <IntakeBar
              intake={total}
              target={targets.targetIntakeKcal}
              burned={burned}
              tdee={targets.tdeeKcal}
            />
          )}
        </div>
      </Panel>

      {capturing ? (
        <MealCapture
          date={date}
          assignment={settings.ai.meal}
          autoOpen={params.get("capture") === "1"}
          onSaved={closeCapture}
          onCancel={closeCapture}
        />
      ) : (
        <Button variant="primary" size="lg" onClick={() => setCapturing(true)}>
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
          onDelete={() => deleteMeal(uid, meal.id, meal.photoPath)}
        />
      ))}
    </>
  );
}

function MealCard({
  meal,
  onDelete,
}: {
  meal: StoredMeal;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
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

  return (
    <Panel
      title={SLOT_LABEL[meal.slot]}
      action={
        confirming ? (
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
