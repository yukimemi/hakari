// "先生と始める": a guided workout with the trainer.
//
// The flow is checkin -> sets and rests -> done. All the rules live in
// `workout/session.ts` (pure, tested); this file only wires them to a
// clock, the voice, the music and the database. Two things it is careful
// about, because they are easy to get wrong in a screen like this:
//
//   - The record is saved the moment the session ends — finished or
//     stopped — under an id fixed at the start, before anything is asked
//     of a model. Pressing a "save" button is not part of the flow.
//   - The teacher never claims to have seen the user. Cues come from the
//     plan, effort comes from what the user tapped, and the closing words
//     are told in as many words that nothing was observed.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useUid } from "../auth/context";
import { useRecentLogs } from "../data/hooks";
import { saveWorkout } from "../data/store";
import AvatarStage from "../avatar/AvatarStage";
import { Mixer, speakDucked } from "../audio/mixer";
import { cancelSpeech, speechSupported } from "../speech/speak";
import { setFallbackVoice, teacher } from "../speech/gemini";
import { sessionPhrases } from "../speech/sessionLines";
import type { TtsPhase } from "../../shared/tts";
import { useWakeLock } from "../lib/wakeLock";
import { api } from "../lib/api";
import { formatKcal } from "../lib/format";
import { todayKey } from "../../shared/calc";
import type {
  BodyShape,
  PlanExercise,
  Settings,
  WorkoutEntry,
} from "../../shared/schema";
import { Alert, Button, Field, NumberInput, Panel, Reading, TextInput } from "../components/ui";
import {
  closingFallback,
  greeting,
  paceCue,
  restCue,
  startCue,
  toHistory,
  type ClosingFacts,
} from "../workout/cues";
import {
  buildSessionEntry,
  estimateFor,
  persistSession,
  type WeightSource,
} from "../workout/record";
import {
  currentSet,
  describeAmount,
  estimateSeconds,
  initialState,
  pacedReps,
  parseAmount,
  planSession,
  reduce,
  secondsLeftInSet,
  summarise,
  type Amount,
  type Energy,
} from "../workout/session";

const TIME_CHOICES = [5, 10, 15, 20, 30];
const ENERGY_CHOICES: { value: Energy; label: string }[] = [
  { value: "high", label: "元気" },
  { value: "ok", label: "ふつう" },
  { value: "low", label: "だるい・やる気が出ない" },
];
const EFFORT_CHOICES = [
  { rpe: 3, label: "楽" },
  { rpe: 6, label: "ちょうどいい" },
  { rpe: 9, label: "きつい" },
];

function newSessionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

type Saved =
  | { kind: "idle" }
  | { kind: "nothing" }
  | { kind: "saving" }
  | { kind: "saved"; entry: WorkoutEntry }
  | { kind: "failed"; entry: WorkoutEntry; message: string };

export default function WorkoutSession({
  exercises,
  title,
  settings,
  shape,
  weight,
  onClose,
}: {
  exercises: PlanExercise[];
  title: string;
  settings: Settings;
  shape: BodyShape;
  weight: WeightSource;
  onClose: () => void;
}) {
  const uid = useUid();
  const [sessionId] = useState(newSessionId);
  const [state, dispatch] = useReducer(reduce, undefined, initialState);
  const [mixer] = useState(() => new Mixer());
  const { workouts, workoutsLoaded } = useRecentLogs(14);
  const history = useMemo(
    () => toHistory(workouts, workoutsLoaded, sessionId),
    [workouts, workoutsLoaded, sessionId],
  );

  const [minutes, setMinutes] = useState<number | undefined>();
  const [energy, setEnergy] = useState<Energy | undefined>();
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [musicOn, setMusicOn] = useState(settings.musicEnabled);
  const [fileName, setFileName] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [correct, setCorrect] = useState("");
  const [actualInput, setActualInput] = useState("");
  const [saved, setSaved] = useState<Saved>({ kind: "idle" });
  const [closing, setClosing] = useState<{ message: string; next: string } | null>(null);
  const [correctError, setCorrectError] = useState<string | null>(null);

  const voiceOk = settings.voiceEnabled && speechSupported();
  const running = state.phase === "active" || state.phase === "rest";
  useWakeLock(running);

  // Gemini speech is opt-in and needs a server key; either way the same
  // `say` is used, and a line that is not cached (or any failure) is spoken
  // by the device voice inside the teacher.
  const geminiOn = voiceOk && settings.geminiVoiceEnabled;

  const say = useCallback(
    (text: string, phase: TtsPhase = "exercise", expiresMs?: number) => {
      setCaption(text);
      if (!voiceOk) return;
      if (geminiOn) {
        setFallbackVoice({ voiceName: settings.voiceName, pitch: settings.voicePitch });
        teacher.say({ text, phase, expiresMs });
      } else {
        speakDucked(mixer, text, {
          voiceName: settings.voiceName,
          pitch: settings.voicePitch,
        });
      }
    },
    [mixer, settings.voiceName, settings.voicePitch, voiceOk, geminiOn],
  );

  // The teacher reports when speech starts and ends (idle edges only), and
  // the mixer's counted duck/release turns that into lowered music.
  useEffect(() => {
    teacher.setGeminiEnabled(geminiOn);
    return teacher.onSpeakingChange((on) => (on ? mixer.duck() : mixer.release()));
  }, [mixer, geminiOn]);

  // Lines are generated while the user is still on the check-in screen and
  // right after Start, never at the moment they are needed. Aborted when
  // the session screen goes away.
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    lifetime.current = new AbortController();
    const controller = lifetime.current;
    return () => controller.abort();
  }, []);
  const prefetchLines = useCallback(
    (steps: Parameters<typeof sessionPhrases>[0]) => {
      if (!geminiOn || history.status !== "ready") return;
      void teacher.prefetch(sessionPhrases(steps, history), lifetime.current?.signal);
    },
    [geminiOn, history],
  );

  // --- check-in ----------------------------------------------------------

  const overrides = useMemo(() => {
    const out: Record<string, Amount> = {};
    for (const [id, text] of Object.entries(typed)) {
      const parsed = parseAmount(text);
      if (parsed) out[id] = parsed;
    }
    return out;
  }, [typed]);

  const plan = useMemo(
    () => planSession(exercises, { minutes, energy }, overrides),
    [exercises, minutes, energy, overrides],
  );

  // --- the clock ---------------------------------------------------------

  useEffect(() => {
    if (!running || state.paused) return;
    const id = window.setInterval(() => dispatch({ type: "tick", now: Date.now() }), 250);
    return () => window.clearInterval(id);
  }, [running, state.paused]);

  // A hidden page stops being updated, so the clock would charge the gap
  // to whichever side it landed on. Pause instead, and make coming back an
  // explicit choice.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        dispatch({ type: "pause", now: Date.now() });
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  // --- voice and music, driven by what the state machine says ------------

  const spoken = useRef(new Set<string>());
  const once = useCallback(
    (key: string, text: string, phase: TtsPhase = "exercise", expiresMs?: number) => {
      if (spoken.current.has(key)) return;
      spoken.current.add(key);
      say(text, phase, expiresMs);
    },
    [say],
  );

  const set = currentSet(state);
  const step = set ? state.steps[set.stepIndex] : undefined;
  const paced = pacedReps(state);
  const left = secondsLeftInSet(state);

  useEffect(() => {
    if (state.phase !== "active" || state.paused || !set || !step) return;
    once(`start:${state.index}`, startCue(step, set));
  }, [state.phase, state.paused, state.index, set, step, once]);

  useEffect(() => {
    if (state.phase !== "active" || state.paused || !set) return;
    const cue = paceCue(set, paced, left);
    if (cue) once(`pace:${state.index}:${cue.id}`, cue.text, "exercise", 3000);
  }, [state.phase, state.paused, state.index, set, paced, left, once]);

  // Timed sets end themselves; rep sets wait for the user to say so.
  useEffect(() => {
    if (state.phase === "active" && !state.paused && left === 0) {
      dispatch({ type: "completeSet", now: Date.now() });
    }
  }, [state.phase, state.paused, left]);

  const lastRpe = state.results.at(-1)?.rpe;
  useEffect(() => {
    if (state.phase !== "rest" || state.paused) return;
    once(
      `rest:${state.index}`,
      restCue({
        setsDone: state.results.length,
        setsTotal: state.queue.length,
        rpe: undefined,
        reduced: state.reduced,
        history,
      }),
      "rest",
    );
  }, [state.phase, state.paused, state.index, state.results.length, state.queue.length, state.reduced, history, once]);

  useEffect(() => {
    if (lastRpe === undefined || state.phase !== "rest") return;
    once(
      `rate:${state.index}`,
      restCue({
        setsDone: state.results.length,
        setsTotal: state.queue.length,
        rpe: lastRpe,
        reduced: state.reduced,
        history,
      }),
      "rest",
    );
  }, [lastRpe, state.phase, state.index, state.results.length, state.queue.length, state.reduced, history, once]);

  useEffect(() => {
    if (state.phase === "active" && !state.paused) mixer.play("workout");
    else if (state.phase === "rest" && !state.paused) mixer.play("rest");
    else mixer.stop();
  }, [state.phase, state.paused, mixer]);

  useEffect(() => {
    if (state.paused || state.phase === "done") {
      cancelSpeech();
      teacher.pause();
    }
  }, [state.paused, state.phase]);

  // Check-in: once the plan has settled for a moment, warm the cache.
  useEffect(() => {
    if (state.phase !== "checkin") return;
    const id = window.setTimeout(() => prefetchLines(plan.steps), 1000);
    return () => window.clearTimeout(id);
  }, [state.phase, plan.steps, prefetchLines]);

  useEffect(
    () => () => {
      cancelSpeech();
      teacher.stop();
      mixer.dispose();
    },
    [mixer],
  );

  // --- saving ------------------------------------------------------------

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const persisted = useRef(false);

  const closingFacts = useCallback(
    (s: typeof state): ClosingFacts => {
      const sum = summarise(s);
      return {
        setsDone: sum.setsDone,
        setsPlanned: sum.setsPlanned,
        activeMin: Math.round((sum.activeSec / 60) * 10) / 10,
        stoppedEarly: s.stoppedEarly,
        reduced: s.reduced,
        oneSet: s.oneSet,
        energy: s.checkin.energy,
        rpe: sum.rpe,
        adjustments: s.adjustments,
        exercises: sum.perExercise.map((e) => e.name),
        history,
      };
    },
    [history],
  );

  /** Saves first, then asks for the closing words. A failed or slow model
   *  never holds the record back. Safe to call twice: the guard stops the
   *  second, and the fixed id would make it harmless anyway. */
  const finalise = useCallback(
    async (s: typeof state, wantClosing: boolean) => {
      if (persisted.current) return;
      persisted.current = true;
      const built = buildSessionEntry({
        state: s,
        sessionId,
        date: todayKey(),
        weight,
      });
      if (!built) {
        setSaved({ kind: "nothing" });
        return;
      }
      setSaved({ kind: "saving" });
      try {
        await persistSession((entry, id) => saveWorkout(uid, entry, id), built.entry, sessionId);
        setSaved({ kind: "saved", entry: built.entry });
      } catch (err) {
        setSaved({
          kind: "failed",
          entry: built.entry,
          message: err instanceof Error ? err.message : "保存に失敗しました",
        });
      }
      if (!wantClosing) return;

      const facts = closingFacts(s);
      const fallback = closingFallback(facts);
      setClosing(fallback);
      try {
        const res = await api.workoutCoach({
          assignment: settings.ai.coach,
          setsDone: facts.setsDone,
          setsPlanned: facts.setsPlanned,
          activeMin: facts.activeMin,
          exercises: facts.exercises,
          stoppedEarly: facts.stoppedEarly,
          reduced: facts.reduced,
          oneSet: facts.oneSet,
          energy: facts.energy,
          rpe: facts.rpe,
          adjustments: facts.adjustments,
          historyKnown: history.status === "ready",
          past: history.status === "ready" ? history.sessions.slice(0, 3) : [],
          activeDays: history.status === "ready" ? history.activeDays : undefined,
        });
        setClosing(res.closing);
        const spokenClosing = `${res.closing.message}${res.closing.next}`;
        if (geminiOn) {
          // The only line that cannot be known before the session ends.
          // The workout is over and saved, so a short wait here costs no
          // timing; past the deadline the device voice speaks it instead.
          await Promise.race([
            teacher.prefetch([{ text: spokenClosing, phase: "closing", personal: true }]),
            new Promise((resolve) => window.setTimeout(resolve, 8000)),
          ]);
        }
        say(spokenClosing, "closing");
      } catch {
        // The template was built from the same facts; it is already on screen.
        say(`${fallback.message}${fallback.next}`, "closing");
      }
    },
    [closingFacts, history, say, geminiOn, sessionId, settings.ai.coach, uid, weight],
  );

  // Deferred a tick so the saving state is not set inside the effect body;
  // a re-render in between cancels it and the effect schedules it again.
  useEffect(() => {
    if (state.phase !== "done") return;
    const id = window.setTimeout(() => void finalise(state, true), 0);
    return () => window.clearTimeout(id);
  }, [state, finalise]);

  // Leaving mid-session (back button, navigation) keeps what was done.
  useEffect(
    () => () => {
      const s = stateRef.current;
      if ((s.phase === "active" || s.phase === "rest") && s.results.length > 0) {
        void finalise({ ...s, phase: "done", stoppedEarly: true }, false);
      }
    },
    // The cleanup must see the latest `finalise`, but must only run on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // --- actions -----------------------------------------------------------

  const begin = (oneSet: boolean) => {
    // Inside the tap: this is what lets audio and speech start at all on
    // iOS, so both are touched here and not from an effect.
    mixer.unlock();
    void teacher.unlock();
    mixer.setEnabled(musicOn);
    prefetchLines(plan.steps);
    const first = plan.steps[0];
    if (first) {
      const firstSet = { stepIndex: 0, setNo: 1, setsOfStep: first.sets, amount: first.amount };
      spoken.current.add("start:0");
      say(startCue(first, firstSet));
    }
    dispatch({
      type: "start",
      now: Date.now(),
      steps: plan.steps,
      checkin: { minutes, energy },
      adjustments: plan.adjustments,
      oneSet,
    });
  };

  const stop = () => {
    cancelSpeech();
    teacher.stop();
    dispatch({ type: "stop", now: Date.now() });
  };

  const submitCorrection = async () => {
    if (saved.kind !== "saved" && saved.kind !== "failed") return;
    const value = Number(correct);
    if (!(value >= 0) || correct.trim() === "") {
      setCorrectError("kcal を数字で入れてください");
      return;
    }
    setCorrectError(null);
    const entry = { ...saved.entry, kcalBurned: Math.round(value) };
    try {
      await saveWorkout(uid, entry, sessionId);
      setSaved({ kind: "saved", entry });
      setCorrect("");
    } catch (err) {
      setCorrectError(err instanceof Error ? err.message : "保存に失敗しました");
    }
  };

  const retry = async () => {
    if (saved.kind !== "failed") return;
    setSaved({ kind: "saving" });
    try {
      await persistSession((entry, id) => saveWorkout(uid, entry, id), saved.entry, sessionId);
      setSaved({ kind: "saved", entry: saved.entry });
    } catch (err) {
      setSaved({
        kind: "failed",
        entry: saved.entry,
        message: err instanceof Error ? err.message : "保存に失敗しました",
      });
    }
  };

  // --- views -------------------------------------------------------------

  const header = (
    <Panel
      title={`先生と運動: ${title}`}
      action={
        <Button onClick={() => { stop(); onClose(); }} className="text-muted">
          戻る
        </Button>
      }
    >
      <div className="h-56 w-full overflow-hidden rounded-lg bg-sunk">
        <AvatarStage
          src={settings.avatarSrc}
          shape={shape}
          exerciseId={step?.exerciseId}
          paused={state.paused || state.phase !== "active"}
          className="h-full w-full"
        />
      </div>
      <p className="mt-3 min-h-[3rem] text-sm leading-relaxed" aria-live="polite">
        {caption || (state.phase === "checkin" ? greeting(history) : "")}
      </p>
      {!voiceOk && (
        <p className="text-xs text-muted">
          音声は使えません (オフか非対応)。字幕と画面の操作で進めます。
        </p>
      )}
    </Panel>
  );

  if (state.phase === "checkin") {
    const unresolved = plan.unresolved.filter((e) => !overrides[e.id]);
    const totalMin = Math.round(estimateSeconds(plan.steps) / 60);
    return (
      <>
        {header}
        <Panel title="今日の状態">
          <div className="space-y-4">
            <Group label="使える時間" hint={minutes === undefined ? "未回答 (量はそのまま)" : undefined}>
              <div className="flex flex-wrap gap-2">
                {TIME_CHOICES.map((m) => (
                  <Chip key={m} on={minutes === m} onClick={() => setMinutes(minutes === m ? undefined : m)}>
                    {m}分
                  </Chip>
                ))}
              </div>
            </Group>
            <Group label="今の元気度" hint={energy === undefined ? "未回答 (量はそのまま)" : undefined}>
              <div className="flex flex-wrap gap-2">
                {ENERGY_CHOICES.map((c) => (
                  <Chip key={c.value} on={energy === c.value} onClick={() => setEnergy(energy === c.value ? undefined : c.value)}>
                    {c.label}
                  </Chip>
                ))}
              </div>
            </Group>
          </div>
        </Panel>

        <Panel title="今日のメニュー">
          {plan.steps.length > 0 && (
            <ul className="divide-y divide-rule/60">
              {plan.steps.map((s) => (
                <li key={s.exerciseId} className="flex items-baseline justify-between py-2 text-sm">
                  <span>{s.name}</span>
                  <span className="reading">
                    {s.sets} × {describeAmount(s.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {plan.steps.length > 0 && (
            <p className="mt-2 text-xs text-muted">目安 約{totalMin}分 (休憩込み)</p>
          )}
          {plan.adjustments.map((a) => (
            <p key={a} className="mt-1 text-xs text-muted">
              ・{a}
            </p>
          ))}

          {unresolved.length > 0 && (
            <div className="mt-3 space-y-3">
              <Alert tone="warn">
                回数・時間を読み取れなかった種目があります。入力してください。
              </Alert>
              {unresolved.map((e) => (
                <Field key={e.id} label={`${e.name} (プラン: ${e.reps})`} hint="例: 12回 / 30秒">
                  <TextInput
                    value={typed[e.id] ?? ""}
                    onChange={(ev) => setTyped((t) => ({ ...t, [e.id]: ev.target.value }))}
                    placeholder="12回"
                  />
                </Field>
              ))}
            </div>
          )}
          {exercises.length === 0 && (
            <p className="text-sm text-muted">種目がありません。先にメニューを作ってください。</p>
          )}
        </Panel>

        <Panel title="音楽">
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">運動中・休憩中に音楽を流す</span>
            <input
              type="checkbox"
              checked={musicOn}
              onChange={(e) => setMusicOn(e.target.checked)}
              className="h-5 w-5 accent-[color:var(--needle)]"
            />
          </label>
          {musicOn && (
            <div className="mt-3">
              <Field
                label="手持ちの音楽ファイル (任意)"
                hint={
                  fileName
                    ? `${fileName} を再生します。端末内だけで使い、送信しません`
                    : "未選択ならアプリ内蔵のBGMを使います"
                }
              >
                <input
                  type="file"
                  accept="audio/*"
                  className="text-sm"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    mixer.setFile(file);
                    setFileName(file?.name ?? null);
                  }}
                />
              </Field>
            </div>
          )}
          <p className="mt-2 text-xs text-muted">先生が話すあいだは、音楽の音量を下げます。</p>
        </Panel>

        <Panel>
          <div className="space-y-2">
            <Button
              variant={energy === "low" ? "quiet" : "primary"}
              size="lg"
              disabled={plan.steps.length === 0 || unresolved.length > 0}
              onClick={() => begin(false)}
            >
              はじめる
            </Button>
            <Button
              variant={energy === "low" ? "primary" : "quiet"}
              size="lg"
              disabled={plan.steps.length === 0 || unresolved.length > 0}
              onClick={() => begin(true)}
            >
              まず1セットだけやる
            </Button>
            <p className="text-center text-xs text-muted">
              1セットで終わっても大丈夫。続けるかはそのあと選べます。
            </p>
          </div>
        </Panel>
      </>
    );
  }

  if (state.phase === "active" && set && step) {
    return (
      <>
        {header}
        <Panel title={`${step.name}  ${set.setNo}/${set.setsOfStep}セット目`}>
          <div className="grid grid-cols-3 gap-2">
            <Reading label="目標" value={describeAmount(set.amount)} size="sm" />
            <Reading
              label={set.amount.kind === "reps" ? "ペース" : "残り"}
              value={set.amount.kind === "reps" ? `${paced}/${set.amount.count}` : `${left ?? 0}秒`}
              size="sm"
            />
            <Reading label="全体" value={`${state.results.length + 1}/${state.queue.length}`} size="sm" />
          </div>
          <p className="mt-2 text-xs text-muted">
            ペースは先生の声かけの目安です。実際にできた回数は「できた」で教えてください。
          </p>
          {state.paused && <Alert tone="warn">一時停止中です。時間は進んでいません。</Alert>}

          <div className="mt-4 space-y-2">
            <Button
              variant="primary"
              size="lg"
              disabled={state.paused}
              onClick={() => dispatch({ type: "completeSet", now: Date.now() })}
            >
              {set.amount.kind === "reps" ? "できた" : "終わった"}
            </Button>
            {set.amount.kind === "reps" && (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label="目標と違うとき: 実際の回数">
                    <NumberInput
                      value={actualInput}
                      onChange={(e) => setActualInput(e.target.value)}
                      suffix="回"
                      inputMode="numeric"
                    />
                  </Field>
                </div>
                <Button
                  disabled={state.paused || !(Number(actualInput) > 0)}
                  onClick={() => {
                    dispatch({ type: "completeSet", now: Date.now(), actual: Number(actualInput) });
                    setActualInput("");
                  }}
                >
                  この回数で完了
                </Button>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <Button
                onClick={() => {
                  dispatch({ type: "reduceIntensity", now: Date.now() });
                  say("了解。残りを軽くしますね。無理のない量でいきましょう。");
                }}
              >
                軽くする
              </Button>
              <Button
                onClick={() =>
                  dispatch({ type: state.paused ? "resume" : "pause", now: Date.now() })
                }
              >
                {state.paused ? "再開" : "一時停止"}
              </Button>
              <Button variant="danger" onClick={stop}>
                終了
              </Button>
            </div>
          </div>
        </Panel>
      </>
    );
  }

  if (state.phase === "rest") {
    const remaining = Math.ceil(state.restLeftMs / 1000);
    const next = state.queue[state.index];
    const nextStep = next ? state.steps[next.stepIndex] : undefined;
    return (
      <>
        {header}
        <Panel title="休憩">
          <div className="flex items-center justify-between">
            <Reading label="残り" value={remaining} unit="秒" size="lg" />
            {nextStep && next && (
              <div className="text-right text-sm">
                <p className="engraved">次</p>
                <p>
                  {nextStep.name} {next.setNo}/{next.setsOfStep}
                </p>
              </div>
            )}
          </div>
          {state.paused && <Alert tone="warn">一時停止中です。休憩のタイマーも止まっています。</Alert>}

          <p className="mt-4 text-sm">今のセット、どうでしたか?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {EFFORT_CHOICES.map((c) => (
              <Chip
                key={c.rpe}
                on={lastRpe === c.rpe}
                onClick={() => dispatch({ type: "rateSet", rpe: c.rpe })}
              >
                {c.label}
              </Chip>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2">
            <Button onClick={() => dispatch({ type: "skipRest", now: Date.now() })} disabled={state.paused}>
              次へ
            </Button>
            <Button
              onClick={() => {
                dispatch({ type: "reduceIntensity", now: Date.now() });
                say("了解。残りを軽くしますね。");
              }}
            >
              軽くする
            </Button>
            <Button
              onClick={() =>
                dispatch({ type: state.paused ? "resume" : "pause", now: Date.now() })
              }
            >
              {state.paused ? "再開" : "一時停止"}
            </Button>
            <Button variant="danger" onClick={stop}>
              終了
            </Button>
          </div>
        </Panel>
      </>
    );
  }

  // done
  const sum = summarise(state);
  const estimate = estimateFor(state, weight);
  const entry = saved.kind === "saved" || saved.kind === "failed" ? saved.entry : null;
  const corrected = entry && entry.kcalEstimated !== undefined && entry.kcalBurned !== entry.kcalEstimated;
  return (
    <>
      {header}
      <Panel title={state.stoppedEarly ? "おつかれさま (途中まで)" : "おつかれさま"}>
        {saved.kind === "nothing" ? (
          <p className="text-sm">
            完了したセットがなかったので、記録は作っていません。また気が向いたらいつでもどうぞ。
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Reading label="セット" value={`${sum.setsDone}/${sum.setsPlanned}`} size="md" />
              <Reading label="運動時間" value={(sum.activeSec / 60).toFixed(1)} unit="分" size="md" />
              <Reading
                label="推定消費"
                value={entry ? (entry.kcalEstimated === undefined && !corrected ? "—" : formatKcal(entry.kcalBurned)) : "…"}
                unit="kcal"
                size="md"
              />
            </div>
            <p className="mt-2 text-xs text-muted">
              推定値です。{estimate.basis}
              {corrected ? ` (あなたの訂正: ${entry.kcalBurned}kcal / 元の推定 ${entry.kcalEstimated}kcal)` : ""}
            </p>
            {estimate.missing.length > 0 && (
              <Alert tone="warn">
                足りない情報: {estimate.missing.join("・")}。補わずに計算しています。
              </Alert>
            )}
          </>
        )}

        {saved.kind === "saving" && <p className="mt-2 text-xs text-muted">記録を保存しています…</p>}
        {saved.kind === "saved" && <p className="mt-2 text-xs text-muted">運動の記録に保存しました。</p>}
        {saved.kind === "failed" && (
          <div className="mt-2">
            <Alert tone="error">保存できませんでした: {saved.message}</Alert>
            <Button className="mt-2" onClick={retry}>
              もう一度保存する
            </Button>
          </div>
        )}
      </Panel>

      {closing && saved.kind !== "nothing" && (
        <Panel title="先生から">
          <p className="text-sm leading-relaxed">{closing.message}</p>
          <p className="mt-2 text-sm font-medium">{closing.next}</p>
        </Panel>
      )}

      {entry && (
        <Panel title="消費カロリーを訂正する">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="実際の値 (わかる場合)">
                <NumberInput
                  value={correct}
                  onChange={(e) => setCorrect(e.target.value)}
                  placeholder={String(entry.kcalBurned)}
                  suffix="kcal"
                  inputMode="numeric"
                />
              </Field>
            </div>
            <Button onClick={submitCorrection}>訂正して保存</Button>
          </div>
          {correctError && <Alert tone="error">{correctError}</Alert>}
        </Panel>
      )}

      <Panel>
        <div className="space-y-2">
          {state.held.length > 0 && !state.stoppedEarly && (
            <Button
              variant="primary"
              size="lg"
              onClick={() => {
                persisted.current = false;
                dispatch({ type: "continue", now: Date.now() });
              }}
            >
              この調子で続ける (あと{state.held.length}セット)
            </Button>
          )}
          <Button size="lg" onClick={onClose}>
            閉じる
          </Button>
        </div>
      </Panel>
    </>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
        on ? "border-ink bg-ink text-panel" : "border-rule bg-panel text-ink hover:bg-sunk"
      }`}
    >
      {children}
    </button>
  );
}

/** `Field` is a <label>, which would forward a tap on its caption to the
 *  first button inside it. A group of chips wants a plain heading. */
function Group({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={label}>
      <span className="engraved mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </div>
  );
}
