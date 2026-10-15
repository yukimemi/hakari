// POST /api/groove-plan
//
// Chooses one exercise per section of a song the user is about to work out
// to. The browser has already found the beat and cut the song into
// sections; what arrives here is only their timing and how hard each one
// hits — never the audio. The model picks from the shared catalogue, and
// anything it returns that the avatar cannot demonstrate, or that needs
// equipment the user does not have, is dropped here. The browser fills the
// gaps with its own rule-based choice, so a partial answer still plays.

import { z } from "zod";
import { GroovePlan, GrooveSectionBrief, MAX_GROOVE_SECTIONS } from "../shared/groove.js";
import { EXERCISE_BY_ID, catalogueForPrompt } from "../shared/exercises.js";
import { PROVIDER_IDS, ProviderError, complete } from "./_lib/providers.js";
import { BadRequest, json, readJson, route } from "./_lib/http.js";
import { requireUser } from "./_lib/auth.js";
import { consumeCall } from "./_lib/usage.js";

const Body = z.object({
  provider: z.enum(PROVIDER_IDS),
  model: z.string().optional(),
  bpm: z.number().min(30).max(300),
  durationSec: z.number().min(1).max(3600),
  sections: z.array(GrooveSectionBrief).min(1).max(MAX_GROOVE_SECTIONS),
  equipment: z.array(z.enum(["none", "mat", "dumbbell", "chair"])).min(1),
  experience: z.enum(["beginner", "intermediate", "advanced"]),
  constraints: z.string().max(500).optional(),
  focusAreas: z.array(z.string().max(40)).max(10).optional(),
});

const SYSTEM = `あなたは音楽に合わせたフィットネスの振付師です。曲を区間に分けたものが
渡されるので、区間ごとに種目を1つずつ選びます。テンポや回数はアプリが曲の拍から
自動で決めるので、あなたは種目選びだけに集中してください。

厳守事項:
- exerciseId は、与えられた種目リストにある id のみを使うこと。
  リストにない種目は 3D アバターが実演できないため、絶対に使わない。
- すべての区間に1つずつ選ぶ。section には区間の index をそのまま入れる。
- level が low の区間は軽い種目 (早歩き・カーフレイズなど) で息を整える。
  high の区間は曲が盛り上がる所なので、有酸素系で心拍を上げる。
- role が warmup の区間は立って行う軽い種目、cooldown の区間は落ち着いた種目にする。
- 床で行う種目と立って行う種目を区間ごとに行き来させない。床の種目はまとめる。
- 隣り合う区間で同じ種目を続けるのは、曲の同じ盛り上がりが続く時だけにする。
- 初心者にはバーピーや通常の腕立てを避ける。
- 制約 (騒音・関節など) は必ず尊重する。ジャンプ禁止ならジャンプ系を外す。
- note では、この曲でのプログラムの狙いを一言で伝える。`;

export const POST = route(async (request) => {
  const user = await requireUser(request);
  await consumeCall(user.uid, user.idToken);
  const body = await readJson(request, Body);

  if (body.sections.some((s, i) => s.index !== i)) {
    throw new BadRequest("区間の番号が連続していません");
  }
  const catalogue = catalogueForPrompt(body.equipment);
  if (!catalogue) {
    throw new ProviderError("選べる種目がありません。器具の設定を見直してください", 400);
  }

  const experienceLabel = {
    beginner: "初心者 (運動習慣なし)",
    intermediate: "中級 (週1-2回は動いている)",
    advanced: "上級 (継続的にトレーニング中)",
  }[body.experience];

  const prompt = [
    `曲: ${Math.round(body.durationSec)}秒 / ${body.bpm} BPM / ${body.sections.length}区間`,
    experienceLabel,
    body.focusAreas?.length ? `重点部位: ${body.focusAreas.join(", ")}` : undefined,
    body.constraints ? `制約: ${body.constraints}` : undefined,
    "",
    "区間 (index: 開始秒-終了秒 / 強さ level / 役割 role):",
    ...body.sections.map(
      (s) =>
        `${s.index}: ${Math.round(s.startSec)}-${Math.round(s.endSec)}秒 / ${s.level} / ${s.role}`,
    ),
    "",
    "使用可能な種目 (この id 以外は使用禁止):",
    catalogue,
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  const result = await complete({
    provider: body.provider,
    model: body.model,
    system: SYSTEM,
    prompt,
    schema: GroovePlan,
    schemaName: "groove_plan",
  });

  // One id per section, in order; null where the model gave nothing usable.
  const picks: (string | null)[] = body.sections.map(() => null);
  for (const pick of result.data.picks) {
    const def = EXERCISE_BY_ID.get(pick.exerciseId);
    const slot = Math.trunc(pick.section);
    if (!def || !body.equipment.includes(def.equipment)) continue;
    if (slot < 0 || slot >= picks.length || picks[slot] !== null) continue;
    picks[slot] = pick.exerciseId;
  }

  if (picks.every((p) => p === null)) {
    throw new ProviderError(
      "使える種目を含むプログラムを作れませんでした。もう一度試してください",
      502,
      result.provider,
    );
  }

  return json({
    picks,
    note: result.data.note.slice(0, 300),
    provider: result.provider,
    model: result.model,
  });
});
