// Meal log for one day, plus the capture flow.

import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useUid } from "../auth/context";
import { useMealsOfDay, useSettings, useUserDoc } from "../data/hooks";
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
import { tdeeForProfile, todayKey } from "../../shared/calc";
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
  const { data: user } = useUserDoc();
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

  const tdee = user.profile
    ? tdeeForProfile(user.profile, user.goal?.startWeightKg ?? 70)
    : 2000;

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
          <Reading label="P" value={Math.round(macros.protein)} unit="g" size="sm" />
          <Reading label="F" value={Math.round(macros.fat)} unit="g" size="sm" />
          <Reading label="C" value={Math.round(macros.carbs)} unit="g" size="sm" />
        </div>
        <div className="mt-3">
          <IntakeBar intake={total} tdee={tdee} />
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
                {item.quantity} · P{Math.round(item.proteinG)} F
                {Math.round(item.fatG)} C{Math.round(item.carbsG)}
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
function IntakeBar({ intake, tdee }: { intake: number; tdee: number }) {
  const scale = Math.max(tdee * 1.25, intake);
  const intakePct = (intake / scale) * 100;
  const tdeePct = (tdee / scale) * 100;
  const over = intake > tdee;

  return (
    <div>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-sunk">
        <div
          className={`h-full rounded-full transition-all duration-700 ${over ? "bg-needle" : "bg-goal"}`}
          style={{ width: `${Math.min(100, intakePct)}%` }}
        />
        <div
          className="absolute top-0 h-full w-px bg-ink"
          style={{ left: `${tdeePct}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-muted">
        消費 {formatKcal(tdee)} kcal に対して{" "}
        {over ? (
          <span className="text-needle">{formatKcal(intake - tdee)} kcal 超過</span>
        ) : (
          <span className="text-goal">あと {formatKcal(tdee - intake)} kcal</span>
        )}
      </p>
    </div>
  );
}
