// POST /api/exercise-kcal
//
// The fixed catalogue in `shared/exercises.ts` has a METs constant per
// exercise, which is enough to compute a deterministic burn (see
// `shared/calc.ts` exerciseKcal). A free-input entry from the workout log
// has no such constant — this route is what backs its "AI で計算" button:
// name + sets + reps (or minutes) + body weight in, an estimate out.

import { z } from "zod";
import { ExerciseBurn } from "../shared/schema.js";
import { PROVIDER_IDS, complete } from "./_lib/providers.js";
import { json, readJson, route } from "./_lib/http.js";
import { requireUser } from "./_lib/auth.js";
import { consumeCall } from "./_lib/usage.js";

const Body = z.object({
  provider: z.enum(PROVIDER_IDS),
  model: z.string().optional(),
  name: z.string().min(1).max(100),
  sets: z.number().min(1).max(50).optional(),
  reps: z.string().max(50).optional(),
  minutes: z.number().min(0).max(600).optional(),
  weightKg: z.number().min(20).max(300),
});

const SYSTEM = `あなたは運動生理学に詳しいトレーナーです。種目名・セット数・回数
（または実施時間）・体重から、その運動でおおよそ何 kcal 消費したかを推定します。

原則:
- 現実的な範囲で見積もる。過大評価も過小評価も避ける。
- 自重・器具・有酸素・無酸素を種目名から判断し、妥当な強度 (METs 相当) を
  推測する。
- セット数と回数（または時間）から、実際に体を動かしていた合計時間を
  見積もった上で計算する。セット間の休憩は消費カロリーにほぼ寄与しない。
- 情報が乏しい種目名でも、一般的な実施方法を仮定して必ず数値を返す。
- 判断根拠を一言で添える（想定した強度や動作時間など）。`;

export const POST = route(async (request) => {
  const user = await requireUser(request);
  await consumeCall(user.uid, user.idToken);
  const body = await readJson(request, Body);

  const detail =
    [
      body.sets ? `${body.sets} セット` : null,
      body.reps ? `${body.reps} 回` : null,
      body.minutes ? `合計 ${body.minutes} 分` : null,
    ]
      .filter(Boolean)
      .join(" x ") || "詳細不明（一般的な実施量を仮定して推定すること）";

  const prompt = [
    `種目: ${body.name}`,
    `実施内容: ${detail}`,
    `体重: ${body.weightKg}kg`,
  ].join("\n");

  const result = await complete({
    provider: body.provider,
    model: body.model,
    system: SYSTEM,
    prompt,
    schema: ExerciseBurn,
    schemaName: "exercise_burn",
    maxTokens: 800,
  });

  return json({
    estimate: result.data,
    provider: result.provider,
    model: result.model,
  });
});
