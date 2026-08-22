/// <reference types="node" />
// Vercel type-checks functions with its own tsconfig, which does not pull
// in the node types our tsconfig.node.json declares; without this the
// build log fills with "Cannot find name 'process'".
// LLM provider registry.
//
// Five backends behind one `complete()` call. Four of them (OpenAI,
// Google Gemini, OpenRouter, DeepSeek) speak the OpenAI chat-completions
// wire format, so they share a single implementation and differ only by
// base URL, env var and default model. Anthropic gets its own path
// because `messages.parse()` + `zodOutputFormat()` gives us schema
// validation the OpenAI-compatible `json_schema` mode does not guarantee
// across every OpenRouter upstream.
//
// Model ids are NOT hardcoded as the source of truth — every provider
// exposes `GET /v1/models`, and `api/models.ts` surfaces that list to the
// settings screen. The defaults below are only used when the user has
// not picked anything yet, and can be overridden per provider with
// `<PROVIDER>_MODEL` env vars without touching code.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { z } from "zod";
import {
  PROVIDER_IDS,
  PROVIDER_META,
  type ProviderId,
} from "../../shared/providers.js";

export { PROVIDER_IDS };
export type { ProviderId };

/** Server-side half of a provider definition: what the browser must never
 *  see (env var names, base URLs) plus the fallback model id. */
export type ProviderSpec = {
  id: ProviderId;
  label: string;
  /** Env var holding the API key. Absence means "not configured". */
  envKey: string;
  /** Env var that overrides `defaultModel`. */
  envModel: string;
  defaultModel: string;
  /** Used in place of `defaultModel` when the request carries images and
   *  no model was named. Providers whose cheap default cannot see need
   *  this, or picking them for a photo task would silently fail. */
  visionModel?: string;
  /** OpenAI-compatible base URL. `null` = native Anthropic SDK. */
  baseURL: string | null;
  /**
   * How this backend can be made to return the shape we asked for.
   *
   * "json_schema" hands the schema to the API and the model is constrained
   * to it. "json_object" only guarantees *some* valid JSON, so the schema
   * has to travel in the prompt and be checked on the way back — DeepSeek
   * answers a json_schema request with "This response_format type is
   * unavailable now", which surfaced as a bare 500 on the training screen.
   */
  structured: "json_schema" | "json_object";
  /** False for text-only backends; the photo routes reject these early
   *  with a message naming a provider that can do the job. */
  vision: boolean;
  docsUrl: string;
};

/**
 * Our own deadline, set below the 300s the function itself gets.
 *
 * Without it a slow provider runs the clock out and the platform kills the
 * request, which reaches the screen as a bare "HTTP 504" — no provider
 * named, nothing to act on. A week-long plan is the case that found this:
 * measured end to end, six days took DeepSeek 106s, Gemini 30s and the
 * same Gemini model through OpenRouter 12s.
 *
 * One attempt, no retries: a retry after a timeout this long cannot finish
 * inside the budget, so it would only turn a clear error into a killed
 * request again.
 *
 * PROVIDER_TIMEOUT_MS overrides it — raise it alongside vercel.json's
 * maxDuration if the plan ever runs on a plan that allows longer functions.
 */
const REQUEST_TIMEOUT_MS =
  Number(process.env.PROVIDER_TIMEOUT_MS) || 280_000;

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  anthropic: {
    ...PROVIDER_META.anthropic,
    id: "anthropic",
    structured: "json_schema",
    envModel: "ANTHROPIC_MODEL",
    defaultModel: "claude-opus-5",
    baseURL: null,
  },
  openai: {
    ...PROVIDER_META.openai,
    id: "openai",
    structured: "json_schema",
    envModel: "OPENAI_MODEL",
    defaultModel: "gpt-5",
    baseURL: "https://api.openai.com/v1",
  },
  google: {
    ...PROVIDER_META.google,
    id: "google",
    structured: "json_schema",
    envModel: "GEMINI_MODEL",
    defaultModel: "gemini-2.5-flash",
    // Gemini OpenAI-compatibility layer. Keeps us on one client for four
    // providers; the native @google/genai SDK buys nothing we use here.
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
  },
  openrouter: {
    ...PROVIDER_META.openrouter,
    id: "openrouter",
    structured: "json_schema",
    envModel: "OPENROUTER_MODEL",
    // Vision-capable and cheap; whatever the user picks in settings wins.
    // `api/models.ts` reports per-model vision support from the
    // OpenRouter `input_modalities` field.
    defaultModel: "google/gemini-2.5-flash",
    baseURL: "https://openrouter.ai/api/v1",
  },
  deepseek: {
    ...PROVIDER_META.deepseek,
    id: "deepseek",
    structured: "json_object",
    envModel: "DEEPSEEK_MODEL",
    defaultModel: "deepseek-v4-flash",
    visionModel: "deepseek-v4-flash-vision-exp",
    baseURL: "https://api.deepseek.com/v1",
  },
};

export function apiKeyFor(id: ProviderId): string | undefined {
  const raw = process.env[PROVIDERS[id].envKey];
  return raw && raw.trim() ? raw.trim() : undefined;
}

export function isConfigured(id: ProviderId): boolean {
  return apiKeyFor(id) !== undefined;
}

export function configuredProviders(): ProviderId[] {
  return PROVIDER_IDS.filter(isConfigured);
}

export function resolveModel(
  id: ProviderId,
  requested?: string,
  needsVision = false,
): string {
  if (requested && requested.trim()) return requested.trim();
  const spec = PROVIDERS[id];
  const fromEnv = process.env[spec.envModel];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return needsVision && spec.visionModel ? spec.visionModel : spec.defaultModel;
}

export class ProviderError extends Error {
  readonly status: number;
  readonly provider: ProviderId | undefined;

  constructor(message: string, status = 502, provider?: ProviderId) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.provider = provider;
  }
}

export type ImageInput = {
  /** Raw base64, no `data:` prefix. */
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
};

export type CompleteRequest<T extends z.ZodType> = {
  provider: ProviderId;
  model?: string;
  system: string;
  prompt: string;
  images?: ImageInput[];
  schema: T;
  schemaName: string;
  maxTokens?: number;
};

export type CompleteResult<T> = {
  data: T;
  provider: ProviderId;
  model: string;
};

/**
 * Runs one structured-output completion against the chosen provider and
 * returns a value already validated against `schema`.
 *
 * Throws `ProviderError` for anything the caller can act on (missing key,
 * text-only provider handed an image, malformed model output).
 */
export async function complete<T extends z.ZodType>(
  req: CompleteRequest<T>,
): Promise<CompleteResult<z.infer<T>>> {
  const spec = PROVIDERS[req.provider];
  const apiKey = apiKeyFor(req.provider);
  if (!apiKey) {
    throw new ProviderError(
      `${spec.label} の API キーが未設定です (${spec.envKey})`,
      400,
      req.provider,
    );
  }
  if (req.images?.length && !spec.vision) {
    throw new ProviderError(
      `${spec.label} は画像入力に対応していません。写真解析には別のプロバイダを選んでください`,
      400,
      req.provider,
    );
  }

  const model = resolveModel(
    req.provider,
    req.model,
    Boolean(req.images?.length),
  );
  const data =
    req.provider === "anthropic"
      ? await completeAnthropic(req, apiKey, model, spec)
      : await completeOpenAICompatible(req, apiKey, model, spec);

  return { data, provider: req.provider, model };
}

async function completeAnthropic<T extends z.ZodType>(
  req: CompleteRequest<T>,
  apiKey: string,
  model: string,
  spec: ProviderSpec,
): Promise<z.infer<T>> {
  const client = new Anthropic({
    apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 0,
  });

  const content: Anthropic.ContentBlockParam[] = [];
  for (const img of req.images ?? []) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: img.mediaType, data: img.base64 },
    });
  }
  content.push({ type: "text", text: req.prompt });

  const response = await callWithClearErrors(spec, () =>
    client.messages.parse({
    model,
    max_tokens: req.maxTokens ?? 8000,
    system: req.system,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(req.schema) },
    }),
  );

  if (response.stop_reason === "refusal") {
    throw new ProviderError(
      "モデルが応答を拒否しました。別の写真か別のプロバイダを試してください",
      422,
      req.provider,
    );
  }
  if (!response.parsed_output) {
    throw new ProviderError(
      "モデルの応答をスキーマに沿って解釈できませんでした",
      502,
      req.provider,
    );
  }
  return response.parsed_output as z.infer<T>;
}

/**
 * Provider APIs reject requests for reasons of their own — an unsupported
 * response_format, an exhausted quota, a retired model — and those arrive
 * as SDK errors rather than ours. Left alone they fall through to the
 * generic 500, which is what put "サーバ内部エラーが発生しました" on the
 * training screen instead of the sentence the provider actually sent.
 */
async function callWithClearErrors<R>(
  spec: ProviderSpec,
  run: () => Promise<R>,
): Promise<R> {
  try {
    return await run();
  } catch (err) {
    // The SDKs do not agree on how a timeout announces itself — one sets a
    // class name, another only the message "Request timed out." — and none
    // of them carry an HTTP status, so the check has to cover both.
    const signature = `${(err as Error).name ?? ""} ${(err as Error).message ?? ""}`;
    if (/timed out|timeout|abort/i.test(signature)) {
      throw new ProviderError(
        `${spec.label} が ${REQUEST_TIMEOUT_MS / 1000} 秒以内に応答しませんでした。` +
          "出力の大きい処理では速いプロバイダ (Gemini / OpenRouter) を選んでください",
        504,
        spec.id,
      );
    }

    const status = (err as { status?: number }).status;
    const upstream =
      (err as { error?: { message?: string } }).error?.message ??
      (err as Error).message;
    if (!status) throw err;
    throw new ProviderError(
      `${spec.label}: ${upstream}`,
      status >= 500 ? 502 : status === 429 ? 429 : 400,
      spec.id,
    );
  }
}

async function completeOpenAICompatible<T extends z.ZodType>(
  req: CompleteRequest<T>,
  apiKey: string,
  model: string,
  spec: ProviderSpec,
): Promise<z.infer<T>> {
  const client = new OpenAI({
    apiKey,
    baseURL: spec.baseURL!,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 0,
    // OpenRouter attributes traffic by these; harmless elsewhere.
    defaultHeaders:
      spec.id === "openrouter"
        ? { "HTTP-Referer": "https://hakari.app", "X-Title": "hakari" }
        : undefined,
  });

  const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [];
  for (const img of req.images ?? []) {
    userContent.push({
      type: "image_url",
      image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
    });
  }
  userContent.push({ type: "text", text: req.prompt });

  // zod v4 ships JSON Schema conversion, so one schema definition feeds
  // both the Anthropic and the OpenAI-compatible path. `io: "output"`
  // emits the post-parse shape, which is what the model must produce.
  const jsonSchema = z.toJSONSchema(req.schema, {
    io: "output",
    target: "draft-7",
  });

  // With only json_object on offer the schema cannot be enforced by the
  // API, so it goes in the system prompt instead and the reply is validated
  // below like any other. DeepSeek also requires the word JSON to appear in
  // the conversation before it will honour json_object at all.
  const constrained = spec.structured === "json_schema";
  const system = constrained
    ? req.system
    : [
        req.system,
        "",
        "出力は次の JSON Schema に厳密に従った JSON オブジェクトだけを返すこと。",
        "説明文、前置き、コードフェンスは一切付けない。",
        JSON.stringify(jsonSchema),
      ].join("\n");

  const response = await callWithClearErrors(spec, () =>
    client.chat.completions.create({
    model,
    max_completion_tokens: req.maxTokens ?? 8000,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
    response_format: constrained
      ? {
          type: "json_schema",
          json_schema: {
            name: req.schemaName,
            schema: jsonSchema as Record<string, unknown>,
            strict: true,
          },
        }
      : { type: "json_object" },
    }),
  );

  const text = response.choices[0]?.message?.content;
  if (!text) {
    throw new ProviderError("モデルが空の応答を返しました", 502, req.provider);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProviderError(
      "モデルの応答が JSON として解釈できませんでした",
      502,
      req.provider,
    );
  }

  const parsed = req.schema.safeParse(raw);
  if (!parsed.success) {
    throw new ProviderError(
      `モデルの応答がスキーマに合いませんでした: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(", ")}`,
      502,
      req.provider,
    );
  }
  return parsed.data as z.infer<T>;
}
