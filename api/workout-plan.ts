// POST /api/workout-plan
//
// Produces a week of training the avatar can actually demonstrate: the
// model may only choose ids from the shared exercise catalogue, and the
// response is re-checked against that catalogue before it goes back to
// the client. A plan naming a motion we have no animation for would leave
// the trainer standing still, which is worse than a duller plan.

import { z } from "zod";
import { WorkoutPlan } from "../shared/schema.js";
import { EXERCISE_BY_ID, catalogueForPrompt } from "../shared/exercises.js";
import { PROVIDER_IDS, ProviderError, complete } from "./_lib/providers.js";
import { json, readJson, route } from "./_lib/http.js";
import { requireUser } from "./_lib/auth.js";
import { consumeCall } from "./_lib/usage.js";

const Body = z.object({
  provider: z.enum(PROVIDER_IDS),
  model: z.string().optional(),
  heightCm: z.number(),
  weightKg: z.number(),
  targetWeightKg: z.number(),
  sex: z.enum(["male", "female"]),
  age: z.number(),
  equipment: z.array(z.enum(["none", "mat", "dumbbell", "chair"])).min(1),
  /** Minutes the user can realistically spend per session. */
  minutesPerSession: z.number().min(5).max(180),
  daysPerWeek: z.number().min(1).max(7),
  /** From the body analysis, when one has been run. */
  focusAreas: z.array(z.string()).optional(),
  bodyType: z.string().optional(),
  /** Anything limiting: bad knees, upstairs neighbours, no jumping. */
  constraints: z.string().max(500).optional(),
  experience: z.enum(["beginner", "intermediate", "advanced"]),
});

const SYSTEM = `あなたはパーソナルトレーナーです。自宅で続けられる1週間のトレーニング
メニューを組みます。

厳守事項:
- exercises の id は、与えられた種目リストにある id のみを使うこと。
  リストにない種目は 3D アバターが実演できないため、絶対に使わない。
- 1セッションが指定分数に収まるようにする。セット数 x 回数 x 休憩で概算し、
  詰め込みすぎない。続かないメニューは価値がゼロ。
- 初心者には膝つき腕立てのような易しい版を優先する。
- 同じ部位を連日追い込まない。筋肉痛で3日目に脱落するのが最大の失敗要因。
- 制約 (騒音・関節など) は必ず尊重する。ジャンプ禁止ならジャンプ系を外す。
- reps は「12回」「30秒」のように単位付きで書く。
- weeklyNote では、このメニューが体重減にどう効くかを一言添える。
  ただし運動だけで痩せるとは言わない。食事管理が主で運動は補助であることを
  正直に伝える。`;

export const POST = route(async (request) => {
  const user = await requireUser(request);
  await consumeCall(user.uid, user.idToken);
  const body = await readJson(request, Body);

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
    "以下の条件で1週間のトレーニングメニューを作ってください。",
    "",
    `身長 ${body.heightCm}cm / 現在 ${body.weightKg}kg / 目標 ${body.targetWeightKg}kg`,
    `${body.sex === "male" ? "男性" : "女性"} ${body.age}歳 / ${experienceLabel}`,
    `週 ${body.daysPerWeek} 回 / 1回 ${body.minutesPerSession} 分`,
    body.bodyType ? `体型タイプ: ${body.bodyType}` : undefined,
    body.focusAreas?.length
      ? `重点部位: ${body.focusAreas.join(", ")}`
      : undefined,
    body.constraints ? `制約: ${body.constraints}` : undefined,
    "",
    "使用可能な種目 (この id 以外は使用禁止):",
    catalogue,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await complete({
    provider: body.provider,
    model: body.model,
    system: SYSTEM,
    prompt,
    schema: WorkoutPlan,
    schemaName: "workout_plan",
  });

  // Guard rail: strip anything the avatar cannot demonstrate rather than
  // trusting the model to have obeyed the id constraint.
  const plan = {
    ...result.data,
    days: result.data.days
      .map((day) => ({
        ...day,
        exercises: day.exercises.filter((e) => EXERCISE_BY_ID.has(e.id)),
      }))
      .filter((day) => day.exercises.length > 0),
  };

  if (plan.days.length === 0) {
    throw new ProviderError(
      "有効な種目を含むメニューを生成できませんでした。もう一度試してください",
      502,
      result.provider,
    );
  }

  return json({ plan, provider: result.provider, model: result.model });
});
