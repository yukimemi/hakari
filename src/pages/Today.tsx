// The dashboard. Answers three questions in order: how far along am I,
// how did today go, and what should I do next.

import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useUid } from "../auth/context";
import { useRecentLogs, useSettings, useUserDoc, useWeights } from "../data/hooks";
import { saveUserSlice } from "../data/store";
import { useTargets } from "../data/useTargets";
import BeamScale from "../components/BeamScale";
import {
  Alert,
  Button,
  Panel,
  Reading,
} from "../components/ui";
import { formatKcal, formatSigned } from "../lib/format";
import type { MealSlot } from "../../shared/schema";

/** Only used to tell the coach which meals of today are already in. */
const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: "朝食",
  lunch: "昼食",
  dinner: "夕食",
  snack: "間食",
};
import {
  dailyBalance,
  movingAverage,
  pace,
  projectGoalDate,
  tdeeForProfile,
  todayKey,
} from "../../shared/calc";
import { api, ApiError } from "../lib/api";
import type { CoachComment } from "../../shared/schema";

export default function Today() {
  const navigate = useNavigate();
  const uid = useUid();
  const { data: user } = useUserDoc();
  const { settings } = useSettings();
  const { data: weights } = useWeights();
  const { byDate, meals } = useRecentLogs(14);

  const today = todayKey();
  const profile = user.profile!;
  const goal = user.goal!;

  const series = useMemo(
    () => weights.map((w) => ({ date: w.date, value: w.weightKg })),
    [weights],
  );
  const smoothed = useMemo(() => movingAverage(series, 7), [series]);

  // Weight, maintenance and the daily budget all come from one place, so
  // this screen and the meals tab cannot drift apart. They used to.
  const targets = useTargets();
  const currentKg = targets?.currentKg ?? goal.startWeightKg;
  const latestRaw = series.at(-1);

  const p = pace({
    currentKg,
    targetKg: goal.targetWeightKg,
    today,
    targetDate: goal.targetDate,
  });
  const projected = projectGoalDate(smoothed, goal.targetWeightKg);

  const tdee = targets?.tdeeKcal ?? tdeeForProfile(profile, currentKg);
  const totals = byDate.get(today) ?? { intakeKcal: 0, burnedKcal: 0 };
  const balance = dailyBalance({
    tdee,
    intakeKcal: totals.intakeKcal,
    burnedKcal: totals.burnedKcal,
  });
  const onTrack = balance.deficit >= p.requiredDailyDeficit;

  return (
    <>
      <Panel>
        <BeamScale
          startKg={goal.startWeightKg}
          currentKg={currentKg}
          targetKg={goal.targetWeightKg}
          projectedKg={undefined}
        />
        <div className="mt-2 grid grid-cols-3 gap-2 border-t border-rule/60 pt-3">
          <Reading
            label="残り"
            value={p.remainingKg > 0 ? p.remainingKg.toFixed(1) : "0.0"}
            unit="kg"
            size="sm"
            tone={p.remainingKg <= 0 ? "goal" : "ink"}
          />
          <Reading
            label="目標日まで"
            value={p.overdue ? "超過" : p.daysLeft}
            unit={p.overdue ? undefined : "日"}
            size="sm"
            tone={p.overdue ? "warn" : "ink"}
          />
          <Reading
            label="必要なマイナス"
            value={formatKcal(Math.max(0, p.requiredDailyDeficit))}
            unit="kcal/日"
            size="sm"
          />
        </div>
        {targets?.belowMinimum && !p.overdue && (
          <Alert tone="warn">
            <p className="font-medium">目標日が近すぎます</p>
            <p className="mt-1 leading-relaxed">
              いまの目標日だと 1 日{" "}
              <strong className="reading">
                {formatKcal(targets.targetIntakeKcal)}
              </strong>{" "}
              kcal まで。基礎代謝{" "}
              <strong className="reading">
                {formatKcal(targets.minimumIntakeKcal)}
              </strong>{" "}
              kcal を下回ります。この状態が続くと筋肉が落ちて代謝が下がるので、
              痩せても戻りやすくなります。
            </p>
            {targets.safeDate && (
              <p className="mt-2 leading-relaxed">
                目標日を <strong className="reading">{targets.safeDate}</strong>{" "}
                まで延ばすと、下回らずに済みます。運動で消費を増やせば、その分
                早まります。
              </p>
            )}
            <Link
              to="/setup"
              className="mt-2 inline-block underline underline-offset-4"
            >
              目標日を変える
            </Link>
          </Alert>
        )}

        {p.aggressive && !targets?.belowMinimum && !p.overdue && (
          <p className="mt-3 text-xs leading-relaxed text-warn">
            週 {p.requiredWeeklyKg.toFixed(2)}kg
            のペースです。体重の0.75%/週を超えると筋肉が落ちやすく、戻りやすくなります。目標日をずらす方が結果的に速いことが多いです。
          </p>
        )}
      </Panel>

      <Panel
        title="今日の収支"
        action={
          <span className="text-xs text-muted">
            {latestRaw?.date === today
              ? `体重 ${latestRaw.value.toFixed(1)}kg`
              : "体重 未記録"}
          </span>
        }
      >
        <div className="grid grid-cols-3 gap-2">
          <Reading label="摂取" value={formatKcal(totals.intakeKcal)} unit="kcal" size="sm" />
          <Reading
            label="消費 (運動)"
            value={formatKcal(totals.burnedKcal)}
            unit="kcal"
            size="sm"
          />
          <Reading label="基礎+活動" value={formatKcal(tdee)} unit="kcal" size="sm" />
        </div>

        <div className="mt-4 border-t border-rule/60 pt-4">
          <Reading
            label="差し引き"
            value={formatSigned(-balance.deficit)}
            unit="kcal"
            size="lg"
            // Before anything is eaten the day is trivially "on track" by a
            // whole TDEE. Showing that in the goal colour reads as praise
            // for not having logged anything yet, so stay neutral until
            // there is a meal to judge.
            tone={
              totals.intakeKcal === 0
                ? "ink"
                : onTrack
                  ? "goal"
                  : balance.deficit < 0
                    ? "needle"
                    : "ink"
            }
          />
          <p className="mt-1 text-sm text-muted">
            {totals.intakeKcal === 0
              ? "まだ何も記録されていません。"
              : onTrack
                ? "この調子で今日を終えられれば目標ペースです。"
                : `目標ペースまであと ${formatKcal(p.requiredDailyDeficit - balance.deficit)} kcal。`}
          </p>
        </div>
      </Panel>

      <CoachPanel
        uid={uid}
        saved={user.coach}
        proteinTargetG={targets?.proteinTargetG}
        assignment={settings.ai.coach}
        byDate={byDate}
        todaysSlots={meals
          .filter((meal) => meal.date === today)
          .map((meal) => SLOT_LABEL[meal.slot])}
        weights={series}
        tdee={tdee}
        goal={goal}
        requiredDailyDeficit={p.requiredDailyDeficit}
      />

      {projected && (
        <Panel title="今のペースの行き先">
          <p className="text-sm">
            このまま続けると{" "}
            <strong className="reading">{projected}</strong> ごろに{" "}
            {goal.targetWeightKg.toFixed(1)}kg に到達します
            {projected > goal.targetDate ? "（目標日より遅れています）" : "（目標日に間に合うペースです）"}。
          </p>
        </Panel>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="primary"
          size="lg"
          onClick={() => navigate("/meals?capture=1")}
        >
          食事を撮る
        </Button>
        <Button size="lg" onClick={() => navigate("/weight?log=1")}>
          体重を記録
        </Button>
      </div>
    </>
  );
}

function CoachPanel({
  uid,
  saved,
  proteinTargetG,
  assignment,
  byDate,
  todaysSlots,
  weights,
  tdee,
  goal,
  requiredDailyDeficit,
}: {
  uid: string;
  saved?: CoachComment & { date: string };
  proteinTargetG?: number;
  assignment: { provider: import("../../shared/providers").ProviderId; model?: string };
  byDate: Map<
    string,
    {
      intakeKcal: number;
      burnedKcal: number;
      proteinG: number;
      fatG: number;
      carbsG: number;
    }
  >;
  todaysSlots: string[];
  weights: { date: string; value: number }[];
  tdee: number;
  goal: { targetWeightKg: number; targetDate: string };
  requiredDailyDeficit: number;
}) {
  const [fresh, setFresh] = useState<CoachComment | null>(null);
  const [busy, setBusy] = useState(false);

  // What was written for today survives a trip to another tab; anything
  // older does not, because a one-liner about yesterday reads as a
  // statement about today.
  const today = todayKey();
  const comment = fresh ?? (saved?.date === today ? saved : null);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => {
    const weightByDate = new Map(weights.map((w) => [w.date, w.value]));
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([date, totals]) => ({
        date,
        weightKg: weightByDate.get(date),
        proteinG: totals.proteinG,
        fatG: totals.fatG,
        carbsG: totals.carbsG,
        intakeKcal: totals.intakeKcal,
        burnedKcal: totals.burnedKcal,
        tdee,
      }));
  }, [byDate, weights, tdee]);

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.coach({
        assignment,
        recentDays: days.length
          ? days
          : [{ date: todayKey(), intakeKcal: 0, burnedKcal: 0, tdee }],
        targetWeightKg: goal.targetWeightKg,
        targetDate: goal.targetDate,
        requiredDailyDeficit,
        // The day is still running. Without the clock the coach reads
        // today's running total as a finished day and tells you to eat
        // more at two in the afternoon.
        localTime: new Intl.DateTimeFormat("ja-JP", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date()),
        loggedSlots: todaysSlots,
        today: todayKey(),
        proteinTargetG,
      });
      setFresh(res.comment);
      // Written for a specific day, so the day travels with it.
      await saveUserSlice(uid, { coach: { ...res.comment, date: todayKey() } });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "コメントを取得できませんでした",
      );
    } finally {
      setBusy(false);
    }
  };

  const tone =
    comment?.mood === "praise"
      ? "goal"
      : comment?.mood === "warn"
        ? "warn"
        : "ink";

  return (
    <Panel
      title="コーチ"
      action={
        <Button onClick={ask} loading={busy}>
          {comment ? "もう一度" : "今日の一言"}
        </Button>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      {!error && !comment && (
        <p className="text-sm text-muted">
          直近の記録を読んで、今日どう動くかを一言で返します。
        </p>
      )}
      {comment && (
        <div>
          <p
            className={`text-base font-bold ${
              tone === "goal" ? "text-goal" : tone === "warn" ? "text-warn" : ""
            }`}
          >
            {comment.headline}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed">{comment.body}</p>
        </div>
      )}
    </Panel>
  );
}
