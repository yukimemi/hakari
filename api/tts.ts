// POST /api/tts
//
// Turns short teacher lines into speech with Gemini, so the browser can
// cache them before a workout starts. The key stays here; the browser only
// ever receives audio. Every failure is a typed `TtsError`, which the
// client answers by falling back to the device voice.

import { TtsRequest, type TtsResponse } from "../shared/tts.js";
import { json, readJson, route } from "./_lib/http.js";
import { requireUser } from "./_lib/auth.js";
import { consumeCall } from "./_lib/usage.js";
import {
  audioSeconds,
  requireTtsKey,
  synthesize,
  ttsConfig,
  ttsProfile,
} from "./_lib/tts.js";

/** Stay under Vercel's ~4.5MB response ceiling once base64'd (x4/3). */
const MAX_AUDIO_BYTES = 3_000_000;

export const POST = route(async (request) => {
  const user = await requireUser(request);
  const body = await readJson(request, TtsRequest);
  // Checked before counting, so a missing key costs the caller nothing.
  const key = requireTtsKey();
  await consumeCall(user.uid, user.idToken, {
    bucket: "tts",
    limit: ttsConfig().dailyRequestLimit,
  });

  // Identical lines in one request are generated once.
  const unique = [
    ...new Map(body.phrases.map((p) => [`${p.phase}\n${p.text}`, p])).values(),
  ];
  // A small worker pool, so a full 6-line request stays inside the
  // per-instance concurrency cap instead of tripping it.
  const results: PromiseSettledResult<{ p: (typeof unique)[number]; wav: Buffer }>[] =
    new Array(unique.length);
  let next = 0;
  const worker = async () => {
    while (next < unique.length) {
      const i = next++;
      const p = unique[i];
      results[i] = await synthesize(p.text, p.phase, key).then(
        (wav) => ({ status: "fulfilled" as const, value: { p, wav } }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(ttsConfig().maxConcurrent, unique.length) }, worker),
  );

  const response: TtsResponse = { profile: ttsProfile(), audio: [], skipped: [] };
  let bytes = 0;
  let firstError: unknown;
  for (const [i, r] of results.entries()) {
    if (r.status === "rejected") {
      firstError ??= r.reason;
      response.skipped.push(unique[i].text);
      continue;
    }
    const { p, wav } = r.value;
    if (bytes + wav.length > MAX_AUDIO_BYTES || audioSeconds(wav) <= 0) {
      response.skipped.push(p.text);
      continue;
    }
    bytes += wav.length;
    response.audio.push({ text: p.text, phase: p.phase, wav: wav.toString("base64") });
  }
  // Partial success is still success: the client falls back per phrase.
  if (!response.audio.length && firstError) throw firstError;
  return json(response);
});
