// POST /api/coach
//
// The daily one-liner on the dashboard. Cheap, text-only, and therefore
// the natural place to point a budget provider like DeepSeek — the photo
// routes need vision, this one does not.

import { z } from "zod";
import { CoachComment } from "../shared/schema.js";
import { PROVIDER_IDS, complete } from "./_lib/providers.js";
import { json, readJson, route } from "./_lib/http.js";
import { requireUser } from "./_lib/auth.js";
import { consumeCall } from "./_lib/usage.js";

const DaySummary = z.object({
  date: z.string(),
  weightKg: z.number().optional(),
  intakeKcal: z.number(),
  burnedKcal: z.number(),
  tdee: z.number(),
  proteinG: z.number().optional(),
  fatG: z.number().optional(),
  carbsG: z.number().optional(),
});

const Body = z.object({
  provider: z.enum(PROVIDER_IDS),
  model: z.string().optional(),
  /** Most recent last. Two weeks is plenty of signal for a one-liner. */
  recentDays: z.array(DaySummary).min(1).max(14),
  targetWeightKg: z.number(),
  targetDate: z.string(),
  requiredDailyDeficit: z.number(),
  /** The caller's local time, HH:mm. Sent because the server runs in UTC
   *  and, more importantly, because today's intake is a running total. */
  localTime: z.string().regex(/^\d{2}:\d{2}$/),
  /** Which of today's meals are already recorded. */
  loggedSlots: z.array(z.string()).default([]),
  /** The caller's today, so the running row can be pointed at rather
   *  than guessed. Told to work from finished days, the model otherwise
   *  labels today's own total 「昨日」. */
  today: z.string(),
  /** Grams of protein worth aiming at, so the comment can judge the
   *  composition of a day and not only its size. */
  proteinTargetG: z.number().optional(),
});

const SYSTEM = `あなたはダイエット中の人に伴走するコーチです。直近の記録を見て、
今日の一言を返します。

原則:
- 数字を1つは具体的に引用する。「頑張っていますね」だけの空虚な励ましは
  役に立たない。
- 順調なら褒める (mood: praise)。停滞や増加が続くなら、責めずに原因の
  当たりをつけて次の一手を出す (mood: warn)。
- 体重の日々の増減には水分と食事内容が乗ることを踏まえ、1日の増加で
  騒がない。見るのは傾向。
- 記録が途切れている場合、記録を再開すること自体を最優先で促す。
- 極端な制限や絶食は絶対に勧めない。摂取が基礎代謝を下回っている日が
  続いていたら、むしろ食べるよう伝える。

今日についての鉄則:
- 今日はまだ終わっていない。**今日の摂取量を1日分の合計として評価しては
  いけない。** 昼過ぎに「摂取が少なすぎる」と言えば、これから夕食を食べる
  人には的外れになる。
- 判断材料は「今の時刻」と「どの食事が記録済みか」。夕食が未記録なら、
  今日の摂取が少ないのは当たり前であって、指摘すべき欠点ではない。
- 今日について言えるのは「残りをどう使うか」だけ。例: 残り予算が
  何kcalあるか、夕食で何を選ぶと目標に収まるか。
- 1日分の総括をしたいときは、今日ではなく昨日以前の記録を根拠にする。
- 日付を取り違えないこと。「今日」と印のある行の数字を「昨日」と呼ばない。

中身を見ること:
- カロリーだけでなく PFC を見る。同じ 900kcal でも、たんぱく質 20g の日と
  90g の日は別の日。
- **減量中に最も重要なのはたんぱく質**。目標を大きく下回っていたら、それを
  数字で指摘し、具体的な食材を挙げる (鶏むね・卵・ギリシャヨーグルト・
  豆腐・魚・プロテインなど)。不足のまま減量を続けると、減るのは脂肪では
  なく筋肉になる。
- 脂質や炭水化物に偏っている日も、責めずに「次はここを替える」の形で言う。
- 指摘は1点に絞る。全部言うと何も伝わらない。

その1点は、上から順に当てはまる最初のものを選ぶ:
1. 記録が途切れている → 再開を促す
2. **たんぱく質が目標の6割未満** → 数字を挙げて食材を提案する。カロリーが
   足りていても、ここが埋まっていない日は減量として失敗している
3. 摂取が基礎代謝を下回っている → 食べるよう伝える
4. 今日の残り予算の使い方
5. 体重の傾向

上位が当てはまるときに下位の話をしない。たとえばたんぱく質が大きく
不足している日に「あと何kcal食べられます」だけを返すのは、いちばん
重要なことを見落としている。`;

export const POST = route(async (request) => {
  const user = await requireUser(request);
  await consumeCall(user.uid, user.idToken);
  const body = await readJson(request, Body);

  const rows = body.recentDays
    .map((d) => {
      const deficit = Math.round(d.tdee - (d.intakeKcal - d.burnedKcal));
      const weight = d.weightKg ? `${d.weightKg.toFixed(1)}kg` : "未記録";
      const macros =
        d.proteinG === undefined
          ? ""
          : ` / P${Math.round(d.proteinG)}g F${Math.round(d.fatG ?? 0)}g C${Math.round(d.carbsG ?? 0)}g`;
      const line = `${d.date}: 体重 ${weight} / 摂取 ${Math.round(d.intakeKcal)}kcal${macros} / 消費(運動) ${Math.round(d.burnedKcal)}kcal / 収支 ${deficit >= 0 ? "-" : "+"}${Math.abs(deficit)}kcal`;
      return d.date === body.today ? `${line}  ← 今日。まだ途中の途中経過` : line;
    })
    .join("\n");

  const todayRow = body.recentDays.find((d) => d.date === body.today);
  const proteinNote = (() => {
    if (!body.proteinTargetG) return "";
    const target = body.proteinTargetG;
    if (todayRow?.proteinG === undefined) {
      return `たんぱく質の目標: 1日 ${target}g`;
    }
    const got = Math.round(todayRow.proteinG);
    const share = Math.round((got / target) * 100);
    const verdict =
      share < 60
        ? " ← 大幅に不足。これを最優先で指摘すること"
        : share < 85
          ? " ← やや不足"
          : " ← 足りている";
    return `今日のたんぱく質: ${got}g / 目標 ${target}g (${share}%)${verdict}`;
  })();

  const slots = body.loggedSlots.length
    ? body.loggedSlots.join("・")
    : "まだ何も記録なし";

  const prompt = [
    "直近の記録:",
    rows,
    "",
    // The judgement is made here rather than left to the model. Asked to
    // rank its own priorities it kept choosing the calorie angle, because
    // "21g" only reads as a problem next to the number it should have been.
    proteinNote,
    `今日の日付: ${body.today}`,
    `今の時刻: ${body.localTime} (今日はまだ途中)`,
    `今日の記録済みの食事: ${slots}`,
    "",
    `目標: ${body.targetDate} までに ${body.targetWeightKg}kg`,
    `目標達成に必要な1日あたりの不足カロリー: ${Math.round(body.requiredDailyDeficit)}kcal`,
  ].join("\n");

  const result = await complete({
    provider: body.provider,
    model: body.model,
    system: SYSTEM,
    prompt,
    schema: CoachComment,
    schemaName: "coach_comment",
    maxTokens: 1500,
  });

  return json({
    comment: result.data,
    provider: result.provider,
    model: result.model,
  });
});
