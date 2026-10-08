/// <reference types="node" />
// Gemini speech generation for the workout teacher.
//
// Checked against https://ai.google.dev/gemini-api/docs/speech-generation:
//   - models `gemini-3.8-flash-tts` / `gemini-3.8-flash-lite-tts`
//   - endpoint POST /v1beta/interactions (not generateContent)
//   - delivery is a `speech_metadata` annotation with a `style` string
//   - voice via generation_config.speech_config[].voice (30 prebuilt names)
//   - Japanese is supported; unary output is WAV, 24kHz mono 16-bit PCM,
//     base64 at `output_audio.data`
// The model and voice below are only defaults; GEMINI_TTS_MODEL and
// GEMINI_TTS_VOICE override them without a code change.

import type { TtsPhase } from "../../shared/tts.js";
import { apiKeyFor } from "./providers.js";

export class TtsError extends Error {
  readonly status: number;
  readonly code: "not_configured" | "limit" | "upstream" | "timeout" | "busy";

  constructor(
    message: string,
    code: TtsError["code"],
    status: number,
  ) {
    super(message);
    this.name = "TtsError";
    this.code = code;
    this.status = status;
  }
}

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

export const DEFAULT_TTS_MODEL = "gemini-3.8-flash-tts";
export const DEFAULT_TTS_VOICE = "Leda";

/** Bump when PERSONA or STYLES change, so cached audio recorded with the
 *  old wording is not served as the new one. */
export const INSTRUCTION_VERSION = "1";

/** The same character in every request is what keeps the voice from
 *  drifting between phrases that are generated minutes apart. */
const PERSONA =
  "明るく親しみやすい日本人の女性パーソナルトレーナー。自然な日本語の話し言葉で、感情をこめて話す。";

const STYLES: Record<TtsPhase, string> = {
  exercise:
    "元気でハキハキと、短く歯切れよく。テンポよく力強い声で、聞いている人を鼓舞する。",
  rest: "落ち着いた穏やかな声で、ゆっくり優しく励ます。息を整えられるような安心感のある話し方。",
  closing:
    "あたたかく、少し誇らしげに。一人ひとりに語りかけるように、ゆっくり心をこめて話す。",
};

const SAMPLE_RATE = 24_000;
const BYTES_PER_SECOND = SAMPLE_RATE * 2;

function intFromEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

export function ttsConfig() {
  return {
    model: process.env.GEMINI_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL,
    voice: process.env.GEMINI_TTS_VOICE?.trim() || DEFAULT_TTS_VOICE,
    timeoutMs: intFromEnv("TTS_TIMEOUT_MS", 20_000),
    maxAudioSec: intFromEnv("TTS_MAX_AUDIO_SEC", 20),
    maxConcurrent: intFromEnv("TTS_MAX_CONCURRENT", 3),
    dailyRequestLimit: intFromEnv("TTS_DAILY_REQUEST_LIMIT", 40),
  };
}

export function ttsProfile(): string {
  const { model, voice } = ttsConfig();
  return `${model}|${voice}|${INSTRUCTION_VERSION}`;
}

export function requireTtsKey(): string {
  const key = apiKeyFor("google");
  if (!key) {
    throw new TtsError("Gemini 音声が設定されていません", "not_configured", 503);
  }
  return key;
}

/** Wraps headerless PCM in a WAV header, for when the API hands back raw
 *  L16 instead of a RIFF file. */
export function pcmToWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(BYTES_PER_SECOND, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function audioSeconds(wav: Buffer): number {
  return Math.max(0, wav.length - 44) / BYTES_PER_SECOND;
}

// Per-instance cap on simultaneous upstream calls.
let inFlight = 0;

export async function synthesize(
  text: string,
  phase: TtsPhase,
  key: string,
): Promise<Buffer> {
  const cfg = ttsConfig();
  if (inFlight >= cfg.maxConcurrent) {
    throw new TtsError("音声生成が混み合っています", "busy", 429);
  }
  inFlight++;
  try {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        signal: AbortSignal.timeout(cfg.timeoutMs),
        body: JSON.stringify({
          model: cfg.model,
          input: [
            {
              type: "user_input",
              content: [
                {
                  type: "text",
                  text,
                  annotations: [
                    {
                      type: "speech_metadata",
                      style: `${PERSONA}${STYLES[phase]}`,
                    },
                  ],
                },
              ],
            },
          ],
          response_format: { type: "audio" },
          generation_config: { speech_config: [{ voice: cfg.voice }] },
        }),
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      // Never forward err.message: undici can include the request URL.
      throw new TtsError(
        timedOut ? "音声生成がタイムアウトしました" : "音声生成に失敗しました",
        timedOut ? "timeout" : "upstream",
        timedOut ? 504 : 502,
      );
    }
    if (!res.ok) {
      console.error("tts upstream status", res.status);
      throw new TtsError("音声生成に失敗しました", "upstream", 502);
    }

    let data: string | undefined;
    try {
      const body = (await res.json()) as { output_audio?: { data?: string } };
      data = body.output_audio?.data;
    } catch {
      /* fall through */
    }
    if (!data) throw new TtsError("音声生成に失敗しました", "upstream", 502);

    const bytes = Buffer.from(data, "base64");
    const wav = bytes.subarray(0, 4).toString("ascii") === "RIFF" ? bytes : pcmToWav(bytes);
    if (audioSeconds(wav) <= 0 || audioSeconds(wav) > cfg.maxAudioSec) {
      throw new TtsError("音声の長さが範囲外でした", "upstream", 502);
    }
    return wav;
  } finally {
    inFlight--;
  }
}
