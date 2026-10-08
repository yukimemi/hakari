// POST /api/workout-coach
//
// The teacher's closing words after a guided session. Only this: cues and
// rest-time encouragement are templates on the client, because they have to
// land on a beat and work offline. This route is called once per session,
// after the workout has already been saved, so a slow or failed answer
// costs nothing but the nicer sentence.

import { z } from "zod";
import { WorkoutClosing } from "../shared/schema.js";
import { PROVIDER_IDS, complete } from "./_lib/providers.js";
import { json, readJson, route } from "./_lib/http.js";
import { requireUser } from "./_lib/auth.js";
import { consumeCall } from "./_lib/usage.js";

const Past = z.object({
  date: z.string(),
  sets: z.number().optional(),
  rpe: z.number().optional(),
  stoppedEarly: z.boolean().optional(),
});

const Body = z.object({
  provider: z.enum(PROVIDER_IDS),
  model: z.string().optional(),
  setsDone: z.number().min(0).max(100),
  setsPlanned: z.number().min(0).max(100),
  activeMin: z.number().min(0).max(600),
  exercises: z.array(z.string().max(60)).max(20),
  stoppedEarly: z.boolean(),
  reduced: z.boolean(),
  oneSet: z.boolean(),
  energy: z.enum(["low", "ok", "high"]).optional(),
  /** Self-reported, 1-10. */
  rpe: z.number().min(1).max(10).optional(),
  adjustments: z.array(z.string().max(100)).max(10),
  /** Previous guided sessions, newest first. Empty with `historyKnown`
   *  true means there are none; `historyKnown` false means we could not
   *  load them, which is not the same thing. */
  historyKnown: z.boolean(),
  past: z.array(Past).max(5),
  activeDays: z.number().min(0).max(14).optional(),
});

const SYSTEM = `あなたは日本語で話す、明るく穏やかな女性のワークアウト講師です。
セッションが終わった直後に、本人へ締めの一言(message)と、次回への短い一言
(next)を返します。

守ること:
- 与えられた事実だけを根拠にする。書かれていない数字や出来事を作らない。
- カメラで見ていないので、フォームについて褒めたり指摘したりしない。
  「きれいなフォームでした」「姿勢が良かった」は禁止。
- 成果だけでなく、来たこと(出席)と、量を調整した判断(軽くした・途中で
  切り上げた・1セットだけ始めた)も具体的に褒める。
- 前回との比較は、過去の記録が与えられているときだけ、記録上の数字として
  言う。過去の記録を取得できていない場合や記録がない場合は、比較しない。
  手動で入れられた記録の中身から進歩を断定しない。
- きつさ(rpe)は本人の自己申告として「教えてくれた」の形で触れる。
- 途中で終えた日を失敗扱いにしない。叱らない。減量や体型の話をしない。
- message は100字以内、next は40字以内。です・ますの話し言葉で。`;

export const POST = route(async (request) => {
  const user = await requireUser(request);
  await consumeCall(user.uid, user.idToken);
  const body = await readJson(request, Body);

  const energy = { low: "低い", ok: "ふつう", high: "元気" } as const;
  const past = !body.historyKnown
    ? "過去の記録: 取得できていない (比較しないこと)"
    : body.past.length === 0
      ? "過去の記録: 先生との運動の記録はまだない (これが最初)"
      : body.past
          .map(
            (p) =>
              `- ${p.date}: ${p.sets ?? "?"}セット${p.rpe ? ` / きつさ ${p.rpe}` : ""}${p.stoppedEarly ? " / 途中終了" : ""}`,
          )
          .join("\n");

  const prompt = [
    `今日の実績: ${body.setsDone}/${body.setsPlanned}セット完了、運動時間 ${body.activeMin}分`,
    `種目: ${body.exercises.join("・") || "なし"}`,
    `途中で終了: ${body.stoppedEarly ? "はい" : "いいえ"}`,
    `途中で軽くした: ${body.reduced ? "はい" : "いいえ"}`,
    `やる気が出ず1セットから始めた: ${body.oneSet ? "はい" : "いいえ"}`,
    `開始前の元気度(自己申告): ${body.energy ? energy[body.energy] : "未回答"}`,
    `きつさ(自己申告, 1-10): ${body.rpe ?? "未回答"}`,
    `今日の調整: ${body.adjustments.join(" / ") || "なし"}`,
    body.activeDays !== undefined
      ? `直近2週間で運動の記録がある日数: ${body.activeDays}日 (今日を除く)`
      : "",
    past,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await complete({
    provider: body.provider,
    model: body.model,
    system: SYSTEM,
    prompt,
    schema: WorkoutClosing,
    schemaName: "workout_closing",
    maxTokens: 800,
  });

  return json({
    closing: result.data,
    provider: result.provider,
    model: result.model,
  });
});
