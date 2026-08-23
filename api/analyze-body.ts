// POST /api/analyze-body
//
// Body photo -> shape parameters that drive the 3D avatar, plus a read on
// which areas to prioritise. The browser has already run MediaPipe over
// the same photo and sends the landmark-derived ratios along; giving the
// model real measurements instead of asking it to eyeball proportions is
// what keeps the avatar from drifting into a generic body.

import { z } from "zod";
import { BodyAnalysis } from "../shared/schema.js";
import { PROVIDER_IDS, complete } from "./_lib/providers.js";
import { json, readJson, route } from "./_lib/http.js";
import { requireUser } from "./_lib/auth.js";
import { consumeCall } from "./_lib/usage.js";

const Measurements = z.object({
  /** All ratios are normalised against the subject height in pixels, so
   *  they are camera-distance independent. */
  shoulderWidthRatio: z.number(),
  hipWidthRatio: z.number(),
  shoulderToHipRatio: z.number(),
  torsoLengthRatio: z.number(),
  legLengthRatio: z.number(),
});

const Body = z.object({
  imageBase64: z.string().min(100),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  provider: z.enum(PROVIDER_IDS),
  model: z.string().optional(),
  heightCm: z.number(),
  weightKg: z.number(),
  sex: z.enum(["male", "female"]),
  age: z.number(),
  /** Absent when MediaPipe could not find a full body in frame. */
  measurements: Measurements.optional(),
  note: z.string().max(300).optional(),
});

const SYSTEM = `あなたはパーソナルトレーナーです。利用者本人が自分の記録用に撮影した
全身写真から、トレーニング計画に必要な体型情報を読み取ります。

出力の使われ方:
- shape の6つの数値は 3D アバターの体型を変形するパラメータです。
  0 が「その身長・体重の平均的な体型」、正が太い/広い、負が細い/狭い。
  身長と体重から期待される平均体型と比べて、写真がどう違うかを表現します。
  範囲は必ず -1.0 〜 1.0 に収めてください。
- focusAreas は運動メニュー生成の入力になります。部位名で簡潔に。
- ウエスト・胸・腕の太さは骨格推定では測れません。渡される実測値は骨格だけなので、
  この3つは写真のシルエットから自分で読み取ってください。
- estimatedWaistCm はへその高さの胴回り (cm) です。身長は分かっているので、
  写真の中で胴の幅が身長の何割を占めるかを読み取り、それを実寸の幅に直してから
  周囲長に換算してください。腹部の断面は真円ではなく楕円で、正面からは奥行きが
  見えないぶんを見込む必要があります。BMI から機械的に逆算した値ではなく、
  写真のシルエットを根拠にしてください。同じ人を別の日に撮った写真どうしで
  比べられることが目的なので、読み取りの基準は毎回そろえてください。

姿勢の原則:
- これは医学的診断ではありません。健康状態や病気について述べないでください。
- 体型の評価は事実ベースで、かつ本人が読んで前に進める書き方にする。
  欠点の列挙ではなく「どこを動かせば一番変わるか」を伝える。
- 写真が不鮮明・部分的で判断できない場合は、身長体重から推定した平均的な
  値を返し、comment でその旨を正直に伝える。数値をでっち上げない。
- 推定体脂肪率とウエスト周囲長はどちらも幅のある概算です。断定的に扱わないでください。`;

export const POST = route(async (request) => {
  const user = await requireUser(request);
  await consumeCall(user.uid, user.idToken);
  const body = await readJson(request, Body);

  const bmiValue = body.weightKg / (body.heightCm / 100) ** 2;

  const lines = [
    "以下の人物の全身写真を解析してください。",
    `身長: ${body.heightCm}cm / 体重: ${body.weightKg}kg / BMI: ${bmiValue.toFixed(1)}`,
    `性別: ${body.sex === "male" ? "男性" : "女性"} / 年齢: ${body.age}歳`,
  ];

  if (body.measurements) {
    const m = body.measurements;
    lines.push(
      "",
      "骨格推定で実測した比率 (身長を1.0としたときの値):",
      `- 肩幅: ${m.shoulderWidthRatio.toFixed(3)}`,
      `- ヒップ幅: ${m.hipWidthRatio.toFixed(3)}`,
      `- 肩幅/ヒップ幅: ${m.shoulderToHipRatio.toFixed(3)}`,
      `- 胴の長さ: ${m.torsoLengthRatio.toFixed(3)}`,
      `- 脚の長さ: ${m.legLengthRatio.toFixed(3)}`,
      "これらは骨格の実測値です。shape の shoulder と hip、胴と脚の釣り合いは",
      "この比率に合わせてください。ウエスト・胸・腕は写真から判断してください。",
    );
  } else {
    lines.push(
      "",
      "骨格の実測には失敗しました (全身が写っていない可能性)。写真から読み取れる範囲で推定してください。",
    );
  }

  if (body.note) lines.push("", `本人からの補足: ${body.note}`);

  const result = await complete({
    provider: body.provider,
    model: body.model,
    system: SYSTEM,
    prompt: lines.join("\n"),
    images: [{ base64: body.imageBase64, mediaType: body.mediaType }],
    schema: BodyAnalysis,
    schemaName: "body_analysis",
  });

  return json({
    analysis: result.data,
    provider: result.provider,
    model: result.model,
  });
});
