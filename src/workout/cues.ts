// What the teacher says, as deterministic templates.
//
// Everything spoken during a session comes from here, not from a model:
// a cue has to land on the beat, work offline, and never invent anything.
// Two rules shape every line.
//
//   1. Only things that are known. The teacher has no camera on the user,
//      so no line praises or corrects form, and no line claims a count the
//      user did not confirm. Self-reported effort is quoted as "you said".
//   2. History is used only where it exists. A history that has not loaded
//      yet and a history that is empty are different situations, and
//      neither is allowed to produce a comparison.

import type { StoredWorkout } from "../data/store";
import { describeAmount, REP_SEC, type Energy, type PlannedSet, type Step } from "./session";

export type PastSession = {
  date: string;
  sets?: number;
  rpe?: number;
  energy?: Energy;
  stoppedEarly?: boolean;
};

export type History =
  | { status: "loading" }
  | {
      status: "ready";
      /** Guided sessions only, newest first. */
      sessions: PastSession[];
      /** Distinct days with any workout record in the window, manual
       *  entries included — attendance, not comparable effort. */
      activeDays: number;
    };

export function toHistory(
  workouts: StoredWorkout[],
  loaded: boolean,
  excludeId?: string,
): History {
  if (!loaded) return { status: "loading" };
  const sessions = workouts
    .filter((w) => w.source === "session" && w.id !== excludeId)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((w) => ({
      date: w.date,
      sets: w.sets,
      rpe: w.rpe,
      energy: w.energy,
      stoppedEarly: w.stoppedEarly,
    }));
  const days = new Set(workouts.filter((w) => w.id !== excludeId).map((w) => w.date));
  return { status: "ready", sessions, activeDays: days.size };
}

export function greeting(history: History): string {
  if (history.status === "ready" && history.sessions[0]) {
    return `こんにちは。前回は${history.sessions[0].date}でしたね。今日はどれくらい時間があって、体調はどうですか?`;
  }
  return "こんにちは。今日はどれくらい時間があって、体調はどうですか?";
}

export function startCue(step: Step, set: PlannedSet): string {
  const amount = describeAmount(set.amount);
  const head = `${step.name}、${set.setNo}セット目、${amount}。`;
  if (set.setNo === 1) {
    return set.amount.kind === "reps"
      ? `${head}${step.cue}。${REP_SEC}秒に1回のゆっくりしたテンポでいきます。スタート!`
      : `${head}${step.cue}。スタート!`;
  }
  return `${head}スタート!`;
}

/** A milestone while a set runs. `id` changes only when a new line is due,
 *  so the caller can speak on change without repeating itself. */
export function paceCue(
  set: PlannedSet,
  paced: number,
  secondsLeft: number | null,
): { id: string; text: string } | null {
  if (set.amount.kind === "reps") {
    const total = set.amount.count;
    if (total >= 6 && paced === Math.floor(total / 2) && paced > 0) {
      return { id: "half", text: `半分。あと${total - paced}回` };
    }
    if (total >= 4 && paced === total - 1) return { id: "last", text: "ラスト1回" };
    if (paced >= total) return { id: "done", text: "できたらボタンを押してね" };
    return null;
  }
  if (secondsLeft === null) return null;
  if (secondsLeft === 10) return { id: "ten", text: "あと10秒" };
  if (secondsLeft === 0) return { id: "end", text: "終了!" };
  return null;
}

export type RestFacts = {
  setsDone: number;
  setsTotal: number;
  /** Effort the user reported after the set just finished. */
  rpe?: number;
  reduced: boolean;
  history: History;
};

export function restCue(f: RestFacts): string {
  const left = f.setsTotal - f.setsDone;
  const last = f.history.status === "ready" ? f.history.sessions[0] : undefined;
  const lines: string[] = [];

  if (f.rpe !== undefined && f.rpe >= 8) {
    lines.push("きついと教えてくれてありがとう。呼吸を整えて、次は軽くしても大丈夫です。");
  } else if (f.rpe !== undefined && f.rpe <= 4) {
    lines.push("楽だったと聞きました。次は丁寧にゆっくり動かしてみましょう。");
  } else if (f.rpe !== undefined) {
    lines.push("ちょうどいいと聞きました。いいペースです。");
  }

  if (f.rpe !== undefined && last?.rpe !== undefined && f.rpe < last.rpe) {
    lines.push(`前回の自己申告はきつさ${last.rpe}。今日は${f.rpe}と感じています。`);
  } else if (f.history.status === "ready" && !last && lines.length === 0) {
    lines.push("今日が最初の記録になります。続けることが一番の力です。");
  }

  if (f.reduced) lines.push("量を調整できているのは、続けるための良い判断です。");
  // Brief on purpose: at most two remarks, then where we are.
  return `${lines.slice(0, 2).join("")}${f.setsDone}セット終わり。あと${left}セット、今は休みましょう。`;
}

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------

export type ClosingFacts = {
  setsDone: number;
  setsPlanned: number;
  activeMin: number;
  stoppedEarly: boolean;
  reduced: boolean;
  oneSet: boolean;
  energy?: Energy;
  rpe?: number;
  adjustments: string[];
  exercises: string[];
  history: History;
};

/** Shown if the model is unreachable; built from the same facts it would
 *  have been given, so the screen reads the same either way. */
export function closingFallback(f: ClosingFacts): { message: string; next: string } {
  const last = f.history.status === "ready" ? f.history.sessions[0] : undefined;
  const parts: string[] = ["今日も来てくれてありがとう。"];

  if (f.oneSet) parts.push("まず1セット始められたこと、それが今日の一番の収穫です。");
  else if (f.stoppedEarly) {
    parts.push(`${f.setsDone}セットで切り上げる判断も、続けるためには大事です。`);
  } else if (f.reduced || f.adjustments.length) {
    parts.push("量を合わせる調整ができたのは、長く続ける人のやり方です。");
  }

  if (last?.sets !== undefined && !last.stoppedEarly && !f.stoppedEarly && f.setsDone > last.sets) {
    parts.push(`記録上、前回の${last.sets}セットから${f.setsDone}セットに増えました。`);
  } else if (f.history.status === "ready" && !last) {
    parts.push("これが先生との最初の記録です。");
  }
  if (f.rpe !== undefined) parts.push(`きつさは${f.rpe}/10と教えてもらいました。`);

  const next =
    f.rpe !== undefined && f.rpe >= 8
      ? "次回は今日より少し軽めから始めましょう。"
      : f.rpe !== undefined && f.rpe <= 4 && !f.reduced
        ? "次回は余裕があれば1セット足すか、一緒に決めましょう。"
        : "次回も今日くらいの量で、また顔を出してくださいね。";
  return { message: parts.join(""), next };
}
