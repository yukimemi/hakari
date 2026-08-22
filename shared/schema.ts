// Shared zod schemas — used by the browser (form validation, Firestore
// document shapes) and by the API routes (LLM structured-output schemas).
//
// Everything the LLM returns goes through one of the `*Result` schemas
// below. They are converted to JSON Schema via `z.toJSONSchema()` for the
// OpenAI-compatible providers and via `zodOutputFormat()` for Anthropic,
// so the same definition drives every provider.

import { z } from "zod";
import { PROVIDER_IDS } from "./providers.js";

/** `yyyy-MM-dd` in the user's local timezone. Used as the Firestore doc id
 *  for weight entries so re-logging the same day overwrites rather than
 *  appends. */
export const DateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const Sex = z.enum(["male", "female"]);
export type Sex = z.infer<typeof Sex>;

/** Multipliers applied to BMR. Values are the standard Harris-Benedict
 *  activity factors; `light` is the realistic default for desk work. */
export const ActivityLevel = z.enum([
  "sedentary",
  "light",
  "moderate",
  "active",
  "very_active",
]);
export type ActivityLevel = z.infer<typeof ActivityLevel>;

export const MealSlot = z.enum(["breakfast", "lunch", "dinner", "snack"]);
export type MealSlot = z.infer<typeof MealSlot>;

// ---------------------------------------------------------------------------
// Firestore documents
// ---------------------------------------------------------------------------

export const Profile = z.object({
  displayName: z.string().default(""),
  heightCm: z.number().min(100).max(250),
  birthYear: z.number().int().min(1900).max(2100),
  sex: Sex,
  activityLevel: ActivityLevel.default("light"),
});
export type Profile = z.infer<typeof Profile>;

export const Goal = z.object({
  startDate: DateKey,
  startWeightKg: z.number().min(20).max(400),
  targetWeightKg: z.number().min(20).max(400),
  targetDate: DateKey,
});
export type Goal = z.infer<typeof Goal>;

export const WeightEntry = z.object({
  date: DateKey,
  weightKg: z.number().min(20).max(400),
  bodyFatPct: z.number().min(1).max(70).optional(),
  note: z.string().max(500).optional(),
});
export type WeightEntry = z.infer<typeof WeightEntry>;

export const MealItem = z.object({
  name: z.string(),
  /** Free-text portion as the model saw it, e.g. "茶碗1杯 (150g)". */
  quantity: z.string(),
  kcal: z.number().min(0).max(5000),
  proteinG: z.number().min(0).max(500),
  fatG: z.number().min(0).max(500),
  carbsG: z.number().min(0).max(1000),
});
export type MealItem = z.infer<typeof MealItem>;

export const MealEntry = z.object({
  date: DateKey,
  slot: MealSlot,
  items: z.array(MealItem),
  totalKcal: z.number().min(0),
  /** Storage path of the photo this was derived from, if any. */
  photoPath: z.string().optional(),
  note: z.string().max(1000).optional(),
  /** Set when the numbers came from an LLM rather than manual entry. */
  source: z.enum(["photo", "manual"]).default("manual"),
});
export type MealEntry = z.infer<typeof MealEntry>;

export const WorkoutEntry = z.object({
  date: DateKey,
  name: z.string(),
  minutes: z.number().min(0).max(600).optional(),
  steps: z.number().min(0).max(200000).optional(),
  kcalBurned: z.number().min(0).max(5000),
  note: z.string().max(500).optional(),
});
export type WorkoutEntry = z.infer<typeof WorkoutEntry>;

// ---------------------------------------------------------------------------
// LLM task results
// ---------------------------------------------------------------------------

/** Meal photo -> itemised calories. Kept flat and unit-explicit: models
 *  hallucinate less when the field name carries the unit. */
export const MealAnalysis = z.object({
  items: z
    .array(
      z.object({
        name: z.string().describe("料理名。日本語で。例: 鶏の唐揚げ"),
        quantity: z
          .string()
          .describe("見た目から推定した分量。例: 5個 (約120g)"),
        kcal: z.number().describe("この品目の推定カロリー (kcal)"),
        proteinG: z.number().describe("たんぱく質 (g)"),
        fatG: z.number().describe("脂質 (g)"),
        carbsG: z.number().describe("炭水化物 (g)"),
        confidence: z
          .number()
          .describe("0.0-1.0。分量が読み取りにくい場合は低く"),
      }),
    )
    .describe("写真に写っている食べ物・飲み物を1品ずつ"),
  totalKcal: z.number().describe("items の kcal 合計"),
  advice: z
    .string()
    .describe("ダイエット中の人向けの一言アドバイス。80字以内。日本語"),
});
export type MealAnalysis = z.infer<typeof MealAnalysis>;

/** Relative shape offsets in [-1, 1]. 0 = average for the given height and
 *  weight; positive = thicker/wider. These drive the VRM bone scaling in
 *  `src/avatar/bodyShape.ts`, so the range is deliberately bounded. */
export const BodyShape = z.object({
  shoulder: z.number().describe("肩幅 -1(狭い) .. 1(広い)"),
  chest: z.number().describe("胸囲 -1 .. 1"),
  waist: z.number().describe("ウエスト -1 .. 1"),
  hip: z.number().describe("ヒップ -1 .. 1"),
  thigh: z.number().describe("太もも -1 .. 1"),
  arm: z.number().describe("腕の太さ -1 .. 1"),
});
export type BodyShape = z.infer<typeof BodyShape>;

export const BodyAnalysis = z.object({
  bodyType: z
    .string()
    .describe("体型タイプ。例: 内臓脂肪型(りんご型) / 皮下脂肪型(洋なし型)"),
  estimatedBodyFatPct: z
    .number()
    .describe("見た目からの推定体脂肪率 (%)。あくまで概算"),
  shape: BodyShape,
  focusAreas: z
    .array(z.string())
    .describe("優先的に落としたい・鍛えたい部位。日本語で2-4個"),
  comment: z
    .string()
    .describe("体型の特徴と方針。励ます調子で。150字以内。日本語"),
});
export type BodyAnalysis = z.infer<typeof BodyAnalysis>;

export const PlanExercise = z.object({
  /** Must be one of the ids passed in the prompt — the avatar can only
   *  demonstrate motions it has a clip for. */
  id: z.string().describe("与えられた種目リストの id のいずれか"),
  name: z.string().describe("種目名 (日本語)"),
  sets: z.number().describe("セット数"),
  reps: z.string().describe("回数または時間。例: 12回 / 30秒"),
  restSec: z.number().describe("セット間の休憩秒数"),
  cue: z.string().describe("フォームのコツを1文。60字以内。日本語"),
});
export type PlanExercise = z.infer<typeof PlanExercise>;

export const WorkoutPlan = z.object({
  days: z
    .array(
      z.object({
        label: z.string().describe("例: Day 1 - 下半身"),
        focus: z.string().describe("その日の狙い。30字以内"),
        exercises: z.array(PlanExercise),
      }),
    )
    .describe("1週間分。休養日は含めない"),
  weeklyNote: z
    .string()
    .describe("週全体の進め方と注意点。150字以内。日本語"),
});
export type WorkoutPlan = z.infer<typeof WorkoutPlan>;

export const CoachComment = z.object({
  headline: z.string().describe("今日の一言。25字以内"),
  body: z.string().describe("具体的な助言。120字以内。日本語"),
  mood: z
    .enum(["praise", "neutral", "warn"])
    .describe("praise=順調, neutral=普通, warn=要注意"),
});
export type CoachComment = z.infer<typeof CoachComment>;

// ---------------------------------------------------------------------------
// App settings
// ---------------------------------------------------------------------------

export const TaskAssignment = z.object({
  provider: z.enum(PROVIDER_IDS),
  /** Empty means "whatever the server default resolves to". */
  model: z.string().optional(),
});
export type TaskAssignment = z.infer<typeof TaskAssignment>;

/** Which provider handles which job. Vision work and cheap text work
 *  usually want different backends, so every task is assigned separately. */
export const AiSettings = z.object({
  meal: TaskAssignment,
  body: TaskAssignment,
  plan: TaskAssignment,
  coach: TaskAssignment,
});
export type AiSettings = z.infer<typeof AiSettings>;

export const TrainingPrefs = z.object({
  equipment: z.array(z.enum(["none", "mat", "dumbbell", "chair"])).default(["none"]),
  minutesPerSession: z.number().min(5).max(180).default(20),
  daysPerWeek: z.number().min(1).max(7).default(3),
  experience: z.enum(["beginner", "intermediate", "advanced"]).default("beginner"),
  constraints: z.string().max(500).default(""),
});
export type TrainingPrefs = z.infer<typeof TrainingPrefs>;

export const Settings = z.object({
  ai: AiSettings,
  training: TrainingPrefs,
  /** Path under public/avatars, or a Storage download URL for a VRM the
   *  user uploaded themselves. */
  avatarSrc: z.string().default("/avatars/trainer.vrm"),
  voiceEnabled: z.boolean().default(true),
  /** Exact name of the speech-synthesis voice to use. Device-specific, so
   *  an unknown one simply falls back to the best available. */
  voiceName: z.string().optional(),
  /** 0.5 (low) .. 2 (high). */
  voicePitch: z.number().min(0.5).max(2).default(1.35),
});
export type Settings = z.infer<typeof Settings>;

/** Used until the user visits the settings screen. Anthropic handles the
 *  two vision tasks because plate-portion estimation is where accuracy
 *  matters most; the text tasks start there too and are the first thing
 *  worth pointing at a cheaper provider. */
export const DEFAULT_SETTINGS: Settings = {
  ai: {
    meal: { provider: "anthropic" },
    body: { provider: "anthropic" },
    plan: { provider: "anthropic" },
    coach: { provider: "anthropic" },
  },
  training: {
    equipment: ["none", "mat"],
    minutesPerSession: 20,
    daysPerWeek: 3,
    experience: "beginner",
    constraints: "",
  },
  avatarSrc: "/avatars/trainer.vrm",
  voiceEnabled: true,
  voicePitch: 1.35,
};
