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

let cachedVoice: SpeechSynthesisVoice | null = null;

/** Picks a Japanese voice once. Voices load asynchronously on some
 *  browsers, so this is re-checked on each call until one turns up. */
function japaneseVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice) return cachedVoice;
  const voices = window.speechSynthesis.getVoices();
  cachedVoice =
    voices.find((v) => v.lang === "ja-JP") ??
    voices.find((v) => v.lang.startsWith("ja")) ??
    null;
  return cachedVoice;
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
    onLevel?: (level: number) => void;
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
  utterance.rate = options.rate ?? 1;
  utterance.pitch = options.pitch ?? 1.05;
  const voice = japaneseVoice();
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

  utterance.onend = () => {
    stopLevel();
    options.onEnd?.();
  };
  utterance.onerror = () => {
    stopLevel();
    options.onEnd?.();
  };

  window.speechSynthesis.speak(utterance);

  return {
    cancel: () => {
      stopLevel();
      window.speechSynthesis.cancel();
    },
  };
}

export function cancelSpeech(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
}
