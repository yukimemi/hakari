// POST /api/analyze-meal
//
// The headline feature: photograph the plate, get an itemised calorie and
// PFC breakdown back. The response is a `MealAnalysis`, which the client
// drops straight into an editable form — the numbers are estimates and
// the user gets the final say before anything is written to Firestore.

import { z } from "zod";
import { MealAnalysis } from "../shared/schema.js";
import { PROVIDER_IDS, complete } from "./_lib/providers.js";
import { json, readJson, route } from "./_lib/http.js";
import { requireUser } from "./_lib/auth.js";
import { consumeCall } from "./_lib/usage.js";

const Body = z
  .object({
    /** Raw base64, no data: prefix. The client downscales to <=1280px
     *  before encoding, which keeps us inside the 4.5MB request limit. */
    imageBase64: z.string().min(100).optional(),
    mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
    provider: z.enum(PROVIDER_IDS),
    model: z.string().optional(),
    /** Anything the photo cannot show: "ドレッシング大さじ2", "ごはん大盛り". */
    hint: z.string().max(300).optional(),
    /** A correction pass. The photo cannot show how much milk went into
     *  the glass; the person who poured it can. When these are present the
     *  names and amounts are taken as given and only the numbers are
     *  worked out again. */
    items: z
      .array(z.object({ name: z.string().min(1), quantity: z.string() }))
      .min(1)
      .max(20)
      .optional(),
  })
  .refine((body) => body.imageBase64 || body.items?.length, {
    message: "写真か品目のどちらかが必要です",
  });

const SYSTEM = `あなたは管理栄養士です。食事の写真から、含まれる食品を1品ずつ特定し、
分量とカロリー・PFC を推定します。

推定の原則:
- 器や箸、缶、スマホなど写り込んだ既知サイズの物を基準にして分量を割り出す。
- 見えない油・調味料も必ず加算する。炒め物なら油、揚げ物なら吸油、
  サラダならドレッシングを含めた値にする。ここを省くと過小評価になる。
- 日本の一般的な外食・中食・家庭料理の標準的な量を基準にする。
  茶碗1杯の白米 = 150g = 約230kcal、丼のごはん = 250g = 約390kcal。
- 飲み物も1品として数える。水・無糖茶は 0kcal で計上してよい。
- 迷う場合は「やや多め」に倒す。ダイエット用途では過小評価が最も害になる。
- confidence は分量の読み取りやすさ。皿の一部しか写っていない、
  中身が見えない容器、といった場合は 0.5 未満にする。

advice は、この食事をダイエット中の人が食べた前提での実用的な一言。
「〜を減らしましょう」ではなく、次の食事でどう調整するかを具体的に。

品目リストが与えられた場合 (再計算):
- **その品目名と分量が正解**。人が実物を見て直した値なので、写真や
  一般的な常識より優先する。「牛乳150ml」を「50ml」に直したなら、
  50ml として計算する。
- 品目を増やしたり減らしたり、名前や分量を書き換えたりしない。
  返す items は与えられた順・同じ数・同じ name と quantity にする。
- 計算し直すのは kcal と PFC だけ。
- confidence は 1 でよい。分量は推定ではなく申告なので。`;

export const POST = route(async (request) => {
  const user = await requireUser(request);
  await consumeCall(user.uid, user.idToken);
  const body = await readJson(request, Body);

  const listed = body.items
    ?.map((item, index) => `${index + 1}. ${item.name} — ${item.quantity}`)
    .join("\n");

  const prompt = [
    listed
      ? "次の品目と分量で、カロリーと PFC を計算し直してください。\n" + listed
      : "この写真の食事を解析してください。",
    listed && body.imageBase64
      ? "写真も添えますが、分量は上の申告が優先です。"
      : undefined,
    body.hint ? `補足情報: ${body.hint}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await complete({
    provider: body.provider,
    model: body.model,
    system: SYSTEM,
    prompt,
    images: body.imageBase64
      ? [
          {
            base64: body.imageBase64,
            mediaType: body.mediaType ?? "image/jpeg",
          },
        ]
      : undefined,
    schema: MealAnalysis,
    schemaName: "meal_analysis",
  });

  return json({
    analysis: result.data,
    provider: result.provider,
    model: result.model,
  });
});
