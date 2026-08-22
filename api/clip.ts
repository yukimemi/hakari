/// <reference types="node" />
// POST /api/clip           — start generating a demonstration clip
// GET  /api/clip?operation= — check on it, and store the result when ready
//
// Veo takes anywhere from eleven seconds to six minutes, which is longer
// than a request should be held open, so generation is split in two: start
// it, then poll. The client shows the clip before anything is committed —
// a generated video is a lottery ticket, and the owner decides which one
// is worth keeping.
//
// Owner only, like the invite list. Guests watch what the owner adopted;
// they do not get to spend money on regenerating it.

import { z } from "zod";
import { EXERCISE_BY_ID } from "../shared/exercises.js";
import { isOwner } from "../shared/access.js";
import { json, readJson, route, BadRequest } from "./_lib/http.js";
import { requireUser, AuthError } from "./_lib/auth.js";
import { consumeCall } from "./_lib/usage.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Cheapest tier — $0.05 a second at 720p. This is a looping
 *  demonstration on a phone, not a film. VEO_MODEL overrides it; the ids
 *  available are veo-3.1-{,fast-,lite-}generate-preview. */
const MODEL = process.env.VEO_MODEL ?? "veo-3.1-lite-generate-preview";

/** Video costs by the second, so it gets its own allowance rather than
 *  sharing the generous one that text calls use. */
const CLIP_LIMIT = Number(process.env.DAILY_CLIP_LIMIT) || 10;

const Start = z.object({ exerciseId: z.string().min(1) });

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new BadRequest("GEMINI_API_KEY が未設定です");
  return key;
}

function bucket(): string {
  const name =
    process.env.FIREBASE_STORAGE_BUCKET ??
    process.env.VITE_FIREBASE_STORAGE_BUCKET;
  if (!name) throw new BadRequest("Storage バケットが未設定です");
  return name;
}

async function ownerOnly(request: Request) {
  const user = await requireUser(request);
  if (!isOwner(user.email)) {
    throw new AuthError("動画の生成は持ち主のみです", 403);
  }
  return user;
}

export const POST = route(async (request) => {
  const user = await ownerOnly(request);
  const { exerciseId } = await readJson(request, Start);

  const exercise = EXERCISE_BY_ID.get(exerciseId);
  if (!exercise) throw new BadRequest("知らない種目です");

  // Counted before the call, because the cost is incurred by starting it.
  await consumeCall(user.uid, user.idToken, {
    bucket: "clip",
    limit: CLIP_LIMIT,
  });

  const prompt = [
    `A fitness instructor demonstrating ${exercise.name} (${exerciseId}).`,
    exercise.cue,
    "Full body visible head to toe, three-quarter view, plain light studio",
    "background, even lighting, no text or captions, no camera cuts.",
    "One slow controlled repetition, starting and ending in the same",
    "position so the clip loops cleanly.",
  ].join(" ");

  const response = await fetch(`${BASE}/models/${MODEL}:predictLongRunning`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        aspectRatio: "16:9",
        resolution: "720p",
        // A number, despite the docs showing it quoted — the string is
        // rejected with INVALID_ARGUMENT, as is numberOfVideos, which the
        // docs list but this model does not accept.
        durationSeconds: 8,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    // Veo has no free tier at all, so a key that works perfectly well for
    // text answers this with a quota error and nothing else. Worth saying
    // plainly rather than letting the raw message imply a rate limit.
    if (response.status === 429) {
      throw new BadRequest(
        "Veo には無料枠がありません。Google AI Studio でこのキーを従量課金に切り替えてください",
      );
    }
    throw new BadRequest(
      `動画の生成を開始できませんでした (${response.status}) ${detail.slice(0, 200)}`,
    );
  }

  const started = (await response.json()) as { name?: string };
  if (!started.name) throw new BadRequest("operation が返りませんでした");

  return json({ operation: started.name, exerciseId });
});

export const GET = route(async (request) => {
  const user = await ownerOnly(request);

  const operation = new URL(request.url).searchParams.get("operation");
  const exerciseId = new URL(request.url).searchParams.get("exerciseId");
  if (!operation || !exerciseId) throw new BadRequest("operation が必要です");

  const status = await fetch(`${BASE}/${operation}`, {
    headers: { "x-goog-api-key": apiKey() },
  });
  if (!status.ok) {
    throw new BadRequest(`状態を取得できませんでした (${status.status})`);
  }

  const body = (await status.json()) as {
    done?: boolean;
    error?: { message?: string };
    response?: {
      generateVideoResponse?: {
        generatedSamples?: { video?: { uri?: string } }[];
      };
    };
  };

  if (body.error) throw new BadRequest(body.error.message ?? "生成に失敗しました");
  if (!body.done) return json({ done: false });

  const uri =
    body.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (!uri) throw new BadRequest("動画の URI が返りませんでした");

  // Google keeps the file for two days, so it has to be pulled across now
  // rather than linked to. Uploaded with the caller's own token, which is
  // what makes the security rules the thing that decides who may write.
  const file = await fetch(uri, { headers: { "x-goog-api-key": apiKey() } });
  if (!file.ok) throw new BadRequest(`動画を取得できませんでした (${file.status})`);
  const bytes = await file.arrayBuffer();

  const path = `clips/${exerciseId}-${operation.split("/").pop()}.mp4`;
  const upload = await fetch(
    `https://firebasestorage.googleapis.com/v0/b/${bucket()}/o?uploadType=media&name=${encodeURIComponent(path)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user.idToken}`,
        "Content-Type": "video/mp4",
      },
      body: bytes,
    },
  );
  if (!upload.ok) {
    const detail = await upload.text();
    throw new BadRequest(
      `保存できませんでした (${upload.status}) ${detail.slice(0, 200)}`,
    );
  }

  return json({ done: true, path, bytes: bytes.byteLength });
});
