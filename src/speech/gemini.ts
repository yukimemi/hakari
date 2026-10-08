// Wires the teacher to the real browser: Cache Storage, the shared
// AudioContext, /api/tts, and the Web Speech fallback.

import { api } from "../lib/api";
import { speak } from "./speak";
import { createTeacher, type AudioContextLike } from "./teacher";
import { createTtsStore } from "./ttsStore";
import type { Prefetchable } from "./teacher";
import { TTS_MAX_CHARS, type TtsPhase } from "../../shared/tts";

type TeacherOptions = { voiceName?: string; pitch?: number };

let options: TeacherOptions = {};

export const teacher = createTeacher({
  store: createTtsStore(),
  audioContext: () => {
    const Ctor =
      typeof window === "undefined"
        ? undefined
        : window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
    return Ctor ? (new Ctor() as unknown as AudioContextLike) : undefined;
  },
  generate: (phrases, signal) => api.generateSpeech(phrases, signal),
  fallback: (text, onEnd) => speak(text, { ...options, onEnd }),
});

/** Voice settings for the device-voice fallback. */
export function setFallbackVoice(next: TeacherOptions): void {
  options = next;
}

// The lines that never change, so they are generated once and shared
// across every workout. Counts stop at 30 — beyond that the rep count is
// the user's own business.
export const MAX_PREFETCH_COUNT = 30;

export function reusablePhrases(sets: number): Prefetchable[] {
  const lines: [string, TtsPhase][] = [
    ...Array.from({ length: MAX_PREFETCH_COUNT }, (_, i) => [`${i + 1}`, "exercise"] as [string, TtsPhase]),
    ...Array.from({ length: Math.min(sets, 10) }, (_, i) => [`${i + 1}セット目、いくよ！`, "exercise"] as [string, TtsPhase]),
    ["ラスト、全力で！", "exercise"],
    ["お疲れさま。ゆっくり息を整えよう。", "rest"],
    ["あと少しで次のセット。準備はいいかな？", "rest"],
  ];
  return lines.map(([text, phase]) => ({ text, phase }));
}

/** The line spoken when an exercise opens. Falls back to a shorter form
 *  rather than being cut mid-sentence, because the server rejects lines
 *  over the phase limit. */
export function introLine(ex: {
  name: string;
  sets: number;
  reps: string;
  cue: string;
}): string {
  const head = `${ex.name}。${ex.sets}セット、${ex.reps}。`;
  const full = `${head}${ex.cue}`;
  const max = TTS_MAX_CHARS.exercise;
  return full.length <= max ? full : head.slice(0, max);
}

/** Closing line for finishing an exercise. Deliberately free of numbers
 *  that change while the clock runs (minutes, kcal), so it can be
 *  generated ahead of time and still be true when it plays. */
export function closingLine(exerciseName: string): string {
  return `${exerciseName}、やりきったね！ここまでよくがんばりました。ゆっくり休んでね。`.slice(
    0,
    TTS_MAX_CHARS.closing,
  );
}
