// Provider identity shared by the browser and the API routes.
//
// Only the parts the settings UI needs to render live here — keys, base
// URLs and the SDK wiring stay server-side in `api/_lib/providers.ts`.

export const PROVIDER_IDS = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "deepseek",
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ProviderMeta = {
  label: string;
  /** Env var the server reads the key from. Shown in setup instructions. */
  envKey: string;
  /** Whether the provider accepts images at all. For OpenRouter this is
   *  per-model, so the settings screen refines it from the live catalogue. */
  vision: boolean;
  docsUrl: string;
  /** One line on when to pick this one. */
  hint: string;
};

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  anthropic: {
    label: "Claude (Anthropic)",
    envKey: "ANTHROPIC_API_KEY",
    vision: true,
    docsUrl: "https://console.anthropic.com/settings/keys",
    hint: "写真の分量推定が最も安定。食事・体型解析の既定に向く",
  },
  openai: {
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
    vision: true,
    docsUrl: "https://platform.openai.com/api-keys",
    hint: "画像・テキストとも汎用。手持ちのキーがあればそのまま使える",
  },
  google: {
    label: "Gemini (Google)",
    envKey: "GEMINI_API_KEY",
    vision: true,
    docsUrl: "https://aistudio.google.com/apikey",
    hint: "無料枠が大きい。毎食の写真解析を安く回したいとき",
  },
  openrouter: {
    label: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    vision: true,
    docsUrl: "https://openrouter.ai/keys",
    hint: "1つのキーで各社のモデルを切替。vision 可否はモデル次第",
  },
  deepseek: {
    label: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    // Vision arrived 2026-08-21 with deepseek-v4-flash-vision-exp. Only
    // that model can see; the plain v4 models are still text-only, which
    // is why the provider carries a separate vision default.
    vision: true,
    docsUrl: "https://platform.deepseek.com/api_keys",
    hint: "非常に安い。画像は vision-exp モデルのみ対応",
  },
};

/** The four places an LLM gets called. Each can point at a different
 *  provider — vision-heavy work on one, cheap text on another. */
export const AI_TASKS = ["meal", "body", "plan", "coach"] as const;
export type AiTask = (typeof AI_TASKS)[number];

export const AI_TASK_META: Record<
  AiTask,
  { label: string; description: string; needsVision: boolean }
> = {
  meal: {
    label: "食事写真の解析",
    description: "写真から料理を特定してカロリーと PFC を推定",
    needsVision: true,
  },
  body: {
    label: "体型写真の解析",
    description: "全身写真から体型パラメータと重点部位を判定",
    needsVision: true,
  },
  plan: {
    label: "トレーニングメニュー生成",
    description: "体型と目標から1週間のメニューを作成",
    needsVision: false,
  },
  coach: {
    label: "毎日のコーチコメント",
    description: "直近の記録を見て今日の一言",
    needsVision: false,
  },
};
