// Voice for the trainer, via the browser's own speech synthesis.
//
// No server, no model download, works offline, and every platform ships
// a Japanese voice. The trade-off is that voice quality is the OS's
// business, not ours — which is why this is a narrow interface: swapping
// in a neural TTS later means reimplementing `speak`/`cancel` and nothing
// else.

export type SpeechHandle = {
  cancel: () => void;
};

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Every Japanese voice the device has. Voices load asynchronously in
 *  some browsers, so this can be empty on the first call and populated on
 *  the next — callers should re-read it after `voiceschanged`. */
export function japaneseVoices(): SpeechSynthesisVoice[] {
  if (!speechSupported()) return [];
  return window.speechSynthesis
    .getVoices()
    .filter((voice) => voice.lang.toLowerCase().startsWith("ja"));
}

/** Names that ship as the female Japanese voice on the platforms this app
 *  actually runs on. Taking the first ja-JP voice instead landed on
 *  Microsoft Ichiro — a man — on Windows, which is not what anyone asked
 *  a cute trainer to sound like. */
const FEMALE_HINTS = [
  "nanami",
  "ayumi",
  "haruka",
  "sayaka",
  "kyoko",
  "o-ren",
  "female",
  "女性",
];

const MALE_HINTS = ["ichiro", "otoya", "keita", "hattori", "male", "男性"];

export function preferredVoice(
  wanted?: string,
): SpeechSynthesisVoice | null {
  const voices = japaneseVoices();
  if (!voices.length) return null;

  const chosen = wanted && voices.find((voice) => voice.name === wanted);
  if (chosen) return chosen;

  const score = (voice: SpeechSynthesisVoice) => {
    const name = voice.name.toLowerCase();
    if (MALE_HINTS.some((hint) => name.includes(hint))) return -1;
    if (FEMALE_HINTS.some((hint) => name.includes(hint))) return 2;
    return 1;
  };

  return [...voices].sort((a, b) => score(b) - score(a))[0] ?? null;
}

/**
 * Speaks `text`, replacing anything currently being said.
 *
 * `onLevel` receives a crude 0-1 mouth-open value. The Web Speech API
 * exposes no audio buffer, so this is synthesised from word-boundary
 * events rather than measured — enough to keep an avatar's mouth in sync
 * with the rhythm of speech, not with its phonemes.
 */
export function speak(
  text: string,
  options: {
    rate?: number;
    pitch?: number;
    /** Exact voice name, as chosen in settings. Falls back to the best
     *  guess for this device when absent or no longer installed. */
    voiceName?: string;
    onLevel?: (level: number) => void;
    /** Speech actually began. Not called when it never does. */
    onStart?: () => void;
    /** Called exactly once, however speech ends: finished, failed,
     *  cancelled, or never reported finishing (see `maxSpeechMs`). */
    onEnd?: () => void;
  } = {},
): SpeechHandle {
  if (!speechSupported() || !text.trim()) {
    options.onEnd?.();
    return { cancel: () => {} };
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  utterance.rate = options.rate ?? 0.98;
  // Above 1 reads as younger and brighter. 1.35 is as far as the built-in
  // voices go before they start to sound pinched rather than cheerful.
  utterance.pitch = options.pitch ?? 1.35;
  const voice = preferredVoice(options.voiceName);
  if (voice) utterance.voice = voice;

  let timer: number | undefined;
  const stopLevel = () => {
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
    options.onLevel?.(0);
  };

  if (options.onLevel) {
    // A gentle oscillation while speaking reads as talking; a flat mouth
    // reads as a bug.
    let phase = 0;
    timer = window.setInterval(() => {
      phase += 0.28;
      options.onLevel?.(0.35 + Math.sin(phase) * 0.3);
    }, 60);
  }

  // Several browsers occasionally never fire `end` (a voice that fails to
  // load, a tab backgrounded mid-sentence). Anything waiting on it — the
  // music held down while the teacher talks — would wait forever, so a
  // ceiling derived from the length of the text ends it regardless.
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(watchdog);
    stopLevel();
    options.onEnd?.();
  };

  utterance.onstart = () => options.onStart?.();
  utterance.onend = finish;
  utterance.onerror = finish;
  const watchdog = window.setTimeout(finish, maxSpeechMs(text, utterance.rate));

  window.speechSynthesis.speak(utterance);

  return {
    cancel: () => {
      window.speechSynthesis.cancel();
      finish();
    },
  };
}

/** Upper bound on how long `text` can plausibly take to say. Japanese
 *  runs at roughly 6-8 characters a second at normal rate; this assumes
 *  half that, plus slack for the voice to start. */
export function maxSpeechMs(text: string, rate = 1): number {
  return Math.round((text.length * 350) / Math.max(0.5, rate)) + 3000;
}

export function cancelSpeech(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
}
