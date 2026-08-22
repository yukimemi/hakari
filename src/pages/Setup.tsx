// First-run setup: the numbers every other screen needs.
//
// Asked once, then editable from settings. The goal date defaults to a
// pace of about 0.5% of bodyweight per week — fast enough to see movement,
// slow enough to keep muscle and to be sustainable.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUid } from "../auth/context";
import { saveGoal, saveProfile, type UserDoc } from "../data/store";
import {
  ACTIVITY_LABEL,
  ACTIVITY_LEVELS,
  KCAL_PER_KG,
  ageFrom,
  bmi,
  bmr,
  daysBetween,
  minimumIntake,
  safeTargetDate,
  tdee,
  todayKey,
  toDateKey,
} from "../../shared/calc";
import {
  Alert,
  Button,
  Field,
  NumberInput,
  Panel,
  Select,
  TextInput,
} from "../components/ui";
import type { ActivityLevel, Sex } from "../../shared/schema";

export default function Setup({ existing }: { existing: UserDoc }) {
  const uid = useUid();
  const navigate = useNavigate();
  const editing = Boolean(existing.profile && existing.goal);

  const [heightCm, setHeightCm] = useState(
    existing.profile?.heightCm?.toString() ?? "",
  );
  const [birthYear, setBirthYear] = useState(
    existing.profile?.birthYear?.toString() ?? "",
  );
  const [sex, setSex] = useState<Sex>(existing.profile?.sex ?? "male");
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>(
    existing.profile?.activityLevel ?? "light",
  );
  const [currentKg, setCurrentKg] = useState(
    existing.goal?.startWeightKg?.toString() ?? "",
  );
  const [targetKg, setTargetKg] = useState(
    existing.goal?.targetWeightKg?.toString() ?? "",
  );
  const [targetDate, setTargetDate] = useState(existing.goal?.targetDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const numbers = useMemo(() => {
    const h = Number(heightCm);
    const w = Number(currentKg);
    const t = Number(targetKg);
    if (!h || !w) return null;
    const suggested = new Date();
    // 0.5% of bodyweight per week is the sustainable default.
    const weeks = t && t < w ? (w - t) / (w * 0.005) : 12;
    suggested.setDate(suggested.getDate() + Math.round(weeks * 7));
    // A date typed rather than picked lands in the past easily — the year
    // field takes four digits one at a time, so 2027 passes through 0002.
    // Clamping that to a single day produced a six-figure number, so say
    // what is wrong instead of computing through it.
    const daysLeft = targetDate ? daysBetween(todayKey(), targetDate) : 0;
    const dailyDeficit =
      t && t < w && daysLeft >= 1 ? ((w - t) * KCAL_PER_KG) / daysLeft : null;

    // What the chosen date actually asks you to eat, against what the body
    // burns at rest. A date is easy to type and its consequence is not
    // obvious, so it is spelled out before it is saved rather than
    // discovered later on the dashboard.
    const maintenance = tdee({
      weightKg: w,
      heightCm: h,
      age: ageFrom(Number(birthYear) || new Date().getFullYear() - 30),
      sex,
      activityLevel,
    });
    const floor = minimumIntake(
      bmr({
        weightKg: w,
        heightCm: h,
        age: ageFrom(Number(birthYear) || new Date().getFullYear() - 30),
        sex,
      }),
      sex,
    );
    const intake = dailyDeficit === null ? null : maintenance - dailyDeficit;

    return {
      bmi: bmi(w, h),
      suggestedDate: toDateKey(suggested),
      pastDate: Boolean(targetDate) && daysLeft < 1,
      dailyDeficit,
      intake,
      floor: Math.round(floor),
      belowMinimum: intake !== null && intake < floor,
      safeDate: safeTargetDate({
        remainingKg: w - t,
        tdee: maintenance,
        minimum: floor,
        from: todayKey(),
      }),
    };
  }, [heightCm, currentKg, targetKg, targetDate, birthYear, sex, activityLevel]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const h = Number(heightCm);
    const y = Number(birthYear);
    const w = Number(currentKg);
    const t = Number(targetKg);
    const date = targetDate || numbers?.suggestedDate;

    if (!h || !y || !w || !t || !date) {
      setError("すべての項目を入力してください");
      return;
    }
    if (t >= w) {
      setError("目標体重は現在の体重より軽い値にしてください");
      return;
    }
    if (daysBetween(todayKey(), date) < 7) {
      setError("目標日は1週間以上先にしてください");
      return;
    }

    setBusy(true);
    try {
      await saveProfile(uid, {
        displayName: existing.profile?.displayName ?? "",
        heightCm: h,
        birthYear: y,
        sex,
        activityLevel,
      });
      await saveGoal(uid, {
        startDate: existing.goal?.startDate ?? todayKey(),
        startWeightKg: existing.goal?.startWeightKg ?? w,
        targetWeightKg: t,
        targetDate: date,
      });
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-8">
      <div>
        <h1 className="reading text-2xl font-bold">
          {editing ? "基本情報を編集" : "まず、あなたの数値を"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          消費カロリーと目標ペースの計算に使います。あとから変更できます。
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <Panel title="からだ">
          <div className="grid grid-cols-2 gap-3">
            <Field label="身長">
              <NumberInput
                value={heightCm}
                onChange={(e) => setHeightCm(e.target.value)}
                step="0.1"
                suffix="cm"
                placeholder="170"
                required
              />
            </Field>
            <Field label="生まれ年">
              <NumberInput
                value={birthYear}
                onChange={(e) => setBirthYear(e.target.value)}
                suffix="年"
                placeholder="1990"
                required
              />
            </Field>
            <Field label="性別">
              <Select
                value={sex}
                onChange={(e) => setSex(e.target.value as Sex)}
              >
                <option value="male">男性</option>
                <option value="female">女性</option>
              </Select>
            </Field>
            <Field label="活動量">
              <Select
                value={activityLevel}
                onChange={(e) =>
                  setActivityLevel(e.target.value as ActivityLevel)
                }
              >
                {ACTIVITY_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {ACTIVITY_LABEL[level]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Panel>

        <Panel title="目標">
          <div className="grid grid-cols-2 gap-3">
            <Field label="今の体重">
              <NumberInput
                value={currentKg}
                onChange={(e) => setCurrentKg(e.target.value)}
                step="0.1"
                suffix="kg"
                placeholder="78.0"
                required
              />
            </Field>
            <Field label="目標体重">
              <NumberInput
                value={targetKg}
                onChange={(e) => setTargetKg(e.target.value)}
                step="0.1"
                suffix="kg"
                placeholder="68.0"
                required
              />
            </Field>
            <div className="col-span-2">
              <Field
                label="目標日"
                hint={
                  numbers?.suggestedDate
                    ? `無理のないペースなら ${numbers.suggestedDate} あたり`
                    : undefined
                }
              >
                <TextInput
                  type="date"
                  value={targetDate}
                  min={todayKey()}
                  onChange={(e) => setTargetDate(e.target.value)}
                />
              </Field>
            </div>
          </div>

          {numbers?.belowMinimum && !numbers.pastDate && (
            <Alert tone="warn">
              <p className="font-medium">この目標日はきついです</p>
              <p className="mt-1 leading-relaxed">
                1 日{" "}
                <strong className="reading">
                  {Math.round(numbers.intake ?? 0).toLocaleString("ja-JP")}
                </strong>{" "}
                kcal しか食べられません。基礎代謝{" "}
                <strong className="reading">
                  {numbers.floor.toLocaleString("ja-JP")}
                </strong>{" "}
                kcal を下回るので、筋肉が落ちて代謝が下がります。
              </p>
              {numbers.safeDate && (
                <p className="mt-2 leading-relaxed">
                  <strong className="reading">{numbers.safeDate}</strong>{" "}
                  以降にすると下回りません。
                </p>
              )}
            </Alert>
          )}

          {numbers?.pastDate && (
            <p className="mt-3 text-sm text-warn">
              目標日が今日より前になっています。
            </p>
          )}

          {numbers?.dailyDeficit && (
            <p className="mt-3 text-sm text-muted">
              このペースだと、消費が摂取を 1 日あたり{" "}
              <strong className="reading text-ink">
                {Math.round(numbers.dailyDeficit).toLocaleString("ja-JP")}
              </strong>{" "}
              kcal 上回る必要があります。
              {numbers.dailyDeficit > 1000 &&
                "　かなり厳しい設定です。目標日を後ろにずらすことを勧めます。"}
            </p>
          )}
        </Panel>

        {error && <Alert tone="error">{error}</Alert>}

        <Button type="submit" variant="primary" size="lg" loading={busy}>
          {editing ? "保存する" : "はじめる"}
        </Button>
      </form>
    </div>
  );
}
