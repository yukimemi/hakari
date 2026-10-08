// Training screen: generate a week, then have the avatar demonstrate.

import { useEffect, useMemo, useRef, useState } from "react";
import { useSubView } from "../lib/subview";
import { useAuth, useUid } from "../auth/context";
import { useSettings, useUserDoc, useWeights } from "../data/hooks";
import { saveUserSlice, saveWorkout } from "../data/store";
import AvatarStage from "../avatar/AvatarStage";
import { MOTIONS } from "../avatar/procedural";
import { shapeFromBmi } from "../avatar/bodyShape";
import { speak, cancelSpeech, speechSupported } from "../speech/speak";
import {
  closingLine,
  introLine,
  setFallbackVoice,
  teacher,
} from "../speech/gemini";
import {
  Alert,
  Button,
  Empty,
  Panel,
  Reading,
  Select,
} from "../components/ui";
import { formatKcal } from "../lib/format";
import { api, ApiError } from "../lib/api";
import Scanning from "../components/Scanning";
import WorkoutLog from "../components/WorkoutLog";
import ClipStage from "../components/ClipStage";
import WorkoutSession from "./WorkoutSession";
import { defaultMenu } from "../workout/session";
import { useClips } from "../data/clips";
import { isOwner } from "../../shared/access";
import { ageFrom, bmi, exerciseKcal, todayKey } from "../../shared/calc";
import { EXERCISE_BY_ID } from "../../shared/exercises";
import type { PlanExercise } from "../../shared/schema";

export default function Training() {
  const uid = useUid();
  const { settings } = useSettings();
  const { data: user } = useUserDoc();
  const { data: weights } = useWeights();

  const profile = user.profile!;
  const goal = user.goal!;
  const currentKg = weights.at(-1)?.weightKg ?? goal.startWeightKg;
  const plan = user.plan;

  // Addressed as `day.id` rather than by id alone: the same movement can
  // appear on more than one day with different sets, and showing the
  // wrong day's numbers is worse than a longer parameter.
  const demoView = useSubView("do");
  const demo = useMemo(() => {
    if (!demoView.value || !plan) return null;
    const [day, id] = splitOnce(demoView.value, ".");
    return (
      plan.days[Number(day)]?.exercises.find((e) => e.id === id) ?? null
    );
  }, [demoView.value, plan]);
  // "先生と始める": the value is the plan day to run, or "free" for the
  // catalogue menu when no plan has been made yet.
  const sessionView = useSubView("session");
  const [pickedDay, setPickedDay] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shape = useMemo(
    () => user.body?.shape ?? shapeFromBmi(bmi(currentKg, profile.heightCm)),
    [user.body, currentKg, profile.heightCm],
  );

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.workoutPlan({
        assignment: settings.ai.plan,
        heightCm: profile.heightCm,
        weightKg: currentKg,
        targetWeightKg: goal.targetWeightKg,
        sex: profile.sex,
        age: ageFrom(profile.birthYear),
        equipment: settings.training.equipment,
        minutesPerSession: settings.training.minutesPerSession,
        daysPerWeek: settings.training.daysPerWeek,
        focusAreas: user.body?.focusAreas,
        bodyType: user.body?.bodyType,
        constraints: settings.training.constraints || undefined,
        experience: settings.training.experience,
      });
      await saveUserSlice(uid, {
        plan: { ...res.plan, generatedAt: todayKey() },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "メニューを作れませんでした");
    } finally {
      setBusy(false);
    }
  };

  // Generate the intro lines of the day picked for today while the menu is
  // on screen, long before anyone taps an exercise; the other days are left
  // alone so the whole week is not bought up front. A guided session warms
  // its own cues (see WorkoutSession). Playback never waits on this: a line
  // that is not cached yet is simply spoken by the device voice.
  const geminiVoice = settings.voiceEnabled && settings.geminiVoiceEnabled;
  useEffect(() => {
    teacher.setGeminiEnabled(geminiVoice);
    if (!geminiVoice || !plan) return;
    const controller = new AbortController();
    const exercises = plan.days[pickedDay]?.exercises ?? [];
    if (!exercises.length) return;
    void teacher.prefetch(
      exercises.map((e) => ({
        text: introLine(e),
        phase: "exercise" as const,
      })),
      controller.signal,
    );
    return () => controller.abort();
  }, [geminiVoice, plan, pickedDay]);

  if (sessionView.value !== null) {
    const day = plan?.days[Number(sessionView.value)];
    return (
      <WorkoutSession
        exercises={day ? day.exercises : defaultMenu(settings.training.equipment)}
        title={day ? day.label : "おすすめメニュー"}
        settings={settings}
        shape={shape}
        weight={
          weights.length > 0
            ? { kg: currentKg, source: "latest" }
            : goal.startWeightKg > 0
              ? { kg: goal.startWeightKg, source: "start" }
              : undefined
        }
        onClose={sessionView.close}
      />
    );
  }

  if (demo) {
    return (
      <Demonstration
        exercise={demo}
        shape={shape}
        avatarSrc={settings.avatarSrc}
        voiceEnabled={settings.voiceEnabled}
        voiceName={settings.voiceName}
        voicePitch={settings.voicePitch}
        geminiVoice={geminiVoice}
        clipSubject={settings.clipSubject}
        weightKg={currentKg}
        onClose={demoView.close}
        onComplete={async (minutes, kcal) => {
          await saveWorkout(uid, {
            date: todayKey(),
            name: demo.name,
            minutes,
            kcalBurned: kcal,
          });
          demoView.close();
        }}
      />
    );
  }

  return (
    <>
      <WorkoutLog date={todayKey()} weightKg={currentKg} />

      <Panel title="先生と運動">
        <p className="text-sm leading-relaxed">
          時間と元気度に合わせて量を調整し、声かけと休憩タイマーで進めます。
          終わると運動の記録に自動で保存されます。
        </p>
        {plan && (
          <Select
            value={pickedDay}
            onChange={(e) => setPickedDay(Number(e.target.value))}
            aria-label="今日やる日"
          >
            {plan.days.map((day, i) => (
              <option key={i} value={i}>
                {day.label}
              </option>
            ))}
          </Select>
        )}
        <Button
          variant="primary"
          size="lg"
          className="mt-3"
          onClick={() => sessionView.open(plan ? String(pickedDay) : "free")}
        >
          先生と始める
        </Button>
      </Panel>

      <Panel
        title={plan ? "今週のメニュー" : "メニュー"}
        action={
          <Button onClick={generate} loading={busy}>
            {plan ? "作り直す" : "作る"}
          </Button>
        }
      >
        {error && <Alert tone="error">{error}</Alert>}

        {busy && (
          <Scanning
            variant="panel"
            everySec={6}
            steps={[
              "体型と目標を読み込んでいます",
              "使える器具から種目を選んでいます",
              "1週間の配分を組んでいます",
              "フォームのコツを書いています",
              "仕上げています",
            ]}
          />
        )}

        {!plan && !error && !busy && (
          <Empty title="まだメニューがありません">
            体型・目標・使える器具から、続けられる分量で組みます。
          </Empty>
        )}

        {plan && (
          <>
            <p className="text-sm leading-relaxed">{plan.weeklyNote}</p>
            {plan.generatedAt && (
              <p className="mt-2 text-xs text-muted">{plan.generatedAt} 作成</p>
            )}
          </>
        )}
      </Panel>

      {plan?.days.map((day, index) => (
        <Panel key={index} title={day.label}>
          <p className="mb-3 text-sm text-muted">{day.focus}</p>
          <ul className="divide-y divide-rule/60">
            {day.exercises.map((exercise, i) => (
              <li key={i}>
                <button
                  onClick={() => {
                    // iOS starts audio only from a tap, so unlock here.
                    void teacher.unlock();
                    demoView.open(`${index}.${exercise.id}`);
                  }}
                  className="flex w-full items-center justify-between gap-3 py-3 text-left hover:opacity-80"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{exercise.name}</p>
                    <p className="truncate text-xs text-muted">{exercise.cue}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="reading text-sm font-semibold">
                      {exercise.sets} × {exercise.reps}
                    </span>
                    <span className="block text-[10px] text-muted">
                      休憩 {exercise.restSec}秒
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </>
  );
}

/** Full-screen demonstration: the avatar performs the movement on loop
 *  while the coaching cue is spoken once. */
export function Demonstration({
  exercise,
  shape,
  avatarSrc,
  voiceEnabled,
  voiceName,
  voicePitch,
  geminiVoice,
  clipSubject,
  weightKg,
  onClose,
  onComplete,
}: {
  exercise: PlanExercise;
  shape: import("../../shared/schema").BodyShape;
  avatarSrc: string;
  voiceEnabled: boolean;
  voiceName?: string;
  voicePitch: number;
  geminiVoice: boolean;
  clipSubject: string;
  weightKg: number;
  onClose: () => void;
  onComplete: (minutes: number, kcal: number) => Promise<void>;
}) {
  const def = EXERCISE_BY_ID.get(exercise.id);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Speak the cue once on open. Repeating it every loop would be noise.
  // With Gemini on, the cached audio plays if it is ready; otherwise the
  // teacher falls back to the device voice by itself.
  const finished = useRef(false);
  useEffect(() => {
    if (!voiceEnabled || !speechSupported()) return;
    setFallbackVoice({ voiceName, pitch: voicePitch });
    if (!geminiVoice) {
      const handle = speak(
        `${exercise.name}。${exercise.sets}セット、${exercise.reps}。${exercise.cue}`,
        { voiceName, pitch: voicePitch },
      );
      return () => handle.cancel();
    }
    const handle = teacher.say({
      text: introLine(exercise),
      phase: "exercise",
      kind: "cue",
    });
    return () => handle.cancel();
  }, [exercise, voiceEnabled, voiceName, voicePitch, geminiVoice]);

  // Personal closing line, generated while the exercise is under way so it
  // is cached by the time the button is pressed. It holds only facts that
  // cannot change before then, so what is played is never stale.
  useEffect(() => {
    if (!voiceEnabled || !geminiVoice) return;
    const controller = new AbortController();
    void teacher.prefetch(
      [{ text: closingLine(exercise.name), phase: "closing", personal: true }],
      controller.signal,
    );
    return () => controller.abort();
  }, [exercise.name, voiceEnabled, geminiVoice]);

  // Leaving mid-exercise silences everything; leaving by completing lets
  // the closing line finish.
  useEffect(
    () => () => {
      if (finished.current) return;
      cancelSpeech();
      teacher.stop();
    },
    [],
  );

  const { user } = useAuth();
  const owner = isOwner(user?.email);
  const clips = useClips();
  const clip = clips[exercise.id];
  // A clip is the better demonstration when there is one; the avatar is
  // the fallback, not the other way round. Derived rather than synced:
  // `prefer` records only a deliberate switch, so a clip arriving mid-view
  // does not need a write inside an effect to be picked up.
  const [prefer, setPrefer] = useState<boolean | null>(null);
  const showClip = prefer ?? Boolean(clip);
  const setShowClip = setPrefer;

  const minutes = Math.max(1, Math.round(elapsedSec / 60));
  const kcal = def
    ? exerciseKcal({ mets: def.mets, weightKg, minutes })
    : 0;

  return (
    <>
      <Panel
        title={exercise.name}
        action={
          <Button onClick={onClose} className="text-muted">
            戻る
          </Button>
        }
      >
        {showClip ? (
          <ClipStage
            // Keyed so the prompt box does not carry one exercise's
            // wording over to the next.
            key={exercise.id}
            exerciseId={exercise.id}
            adopted={clip}
            canGenerate={owner}
            subject={clipSubject}
          />
        ) : (
          <div className="h-80 w-full overflow-hidden rounded-lg bg-sunk">
            <AvatarStage
              src={avatarSrc}
              shape={shape}
              exerciseId={exercise.id}
              speed={speed}
              paused={paused}
              className="h-full w-full"
            />
          </div>
        )}

        {(clip || owner) && (
          <div className="mt-2 flex gap-1">
            {[
              { value: true, label: "動画" },
              { value: false, label: "3D" },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => setShowClip(option.value)}
                className={`rounded-lg px-2 py-1 text-xs transition-colors ${
                  showClip === option.value
                    ? "bg-sunk text-ink"
                    : "text-muted hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <Button
            onClick={() => {
              // A pause drops pending speech instead of letting it play
              // over a frozen exercise; nothing replays on resume.
              if (!paused) teacher.pause();
              setPaused((p) => !p);
            }}
          >
            {paused ? "再生" : "一時停止"}
          </Button>
          <div className="flex flex-1 items-center gap-2">
            <span className="engraved">速さ</span>
            <input
              type="range"
              min={0.4}
              max={1.6}
              step={0.1}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="w-full accent-[color:var(--needle)]"
              aria-label="実演の速さ"
            />
            <span className="reading w-10 text-right text-sm">
              {speed.toFixed(1)}×
            </span>
          </div>
        </div>

        {!(exercise.id in MOTIONS) && (
          <p className="mt-3 text-xs text-muted">
            この種目は専用モーションがないため、待機姿勢で表示しています。
          </p>
        )}
      </Panel>

      <Panel title="やり方">
        <div className="grid grid-cols-3 gap-2">
          <Reading label="セット" value={exercise.sets} size="sm" />
          <Reading label="回数" value={exercise.reps} size="sm" />
          <Reading label="休憩" value={exercise.restSec} unit="秒" size="sm" />
        </div>
        <p className="mt-3 text-sm leading-relaxed">{exercise.cue}</p>
        {def && def.cue !== exercise.cue && (
          <p className="mt-2 text-sm leading-relaxed text-muted">{def.cue}</p>
        )}
      </Panel>

      <Panel title="記録">
        <div className="flex items-center justify-between">
          <Reading
            label="経過"
            value={`${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, "0")}`}
            size="md"
          />
          <Reading label="推定消費" value={formatKcal(kcal)} unit="kcal" size="md" />
        </div>
        <div className="mt-3">
          <Button
            variant="primary"
            size="lg"
            loading={saving}
            onClick={async () => {
              setSaving(true);
              let closingSpeech: { cancel: () => void } | undefined;
              if (voiceEnabled && geminiVoice) {
                finished.current = true;
                closingSpeech = teacher.say({
                  text: closingLine(exercise.name),
                  phase: "closing",
                });
              }
              try {
                await onComplete(minutes, kcal);
              } catch {
                // The save failed and the screen stays: the closing words
                // are cancelled and leaving silences everything again.
                finished.current = false;
                closingSpeech?.cancel();
                setSaving(false);
              }
            }}
          >
            この種目を完了にする
          </Button>
        </div>
      </Panel>
    </>
  );
}

/** `split` with a limit keeps the tail, which is what an id containing
 *  the separator would need; the built-in one drops it. */
function splitOnce(value: string, separator: string): [string, string] {
  const at = value.indexOf(separator);
  return at < 0
    ? [value, ""]
    : [value.slice(0, at), value.slice(at + separator.length)];
}
