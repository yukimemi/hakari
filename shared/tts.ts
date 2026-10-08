// Wire contract and limits for /api/tts, shared by the route and the
// browser so the two cannot drift on what a legal request is.

import { z } from "zod";

/** Delivery the teacher uses. Counts and set cues are "exercise". */
export const TTS_PHASES = ["exercise", "rest", "closing"] as const;
export type TtsPhase = (typeof TTS_PHASES)[number];

/** Longest line per phase. Short on purpose: a cue that cannot be said
 *  inside the beat it belongs to is no use, and characters are what the
 *  provider bills. */
export const TTS_MAX_CHARS: Record<TtsPhase, number> = {
  exercise: 80,
  rest: 80,
  closing: 200,
};

/** Phrases per request. Together with `TTS_MAX_AUDIO_BYTES` this keeps the
 *  response well under the ~4.5MB a Vercel function may return. */
export const TTS_MAX_PHRASES = 6;
export const TTS_MAX_TOTAL_CHARS = 400;

export const TtsPhrase = z
  .object({
    text: z.string().trim().min(1).max(TTS_MAX_CHARS.closing),
    phase: z.enum(TTS_PHASES),
  })
  .refine((p) => p.text.length <= TTS_MAX_CHARS[p.phase], {
    message: "text is too long for this phase",
    path: ["text"],
  });
export type TtsPhrase = z.infer<typeof TtsPhrase>;

export const TtsRequest = z
  .object({ phrases: z.array(TtsPhrase).min(1).max(TTS_MAX_PHRASES) })
  .refine(
    (r) => r.phrases.reduce((n, p) => n + p.text.length, 0) <= TTS_MAX_TOTAL_CHARS,
    { message: "too many characters in one request", path: ["phrases"] },
  );

export type TtsAudio = {
  text: string;
  phase: TtsPhase;
  /** 16-bit mono PCM in a WAV container, base64. */
  wav: string;
};

export type TtsResponse = {
  /** `model|voice|instruction-version`. Part of every cache key, so
   *  changing any of the three retires old audio on its own. */
  profile: string;
  audio: TtsAudio[];
  /** Phrases left out because the response size budget ran out. */
  skipped: string[];
};

/** Machine-readable reason, so the client can pick a fallback without
 *  parsing Japanese error text. */
export type TtsErrorCode =
  | "not_configured"
  | "limit"
  | "upstream"
  | "timeout"
  | "busy";
