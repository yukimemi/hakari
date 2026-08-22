// GET /api/models
//   -> { providers: [{ id, label, configured, vision, docsUrl, defaultModel }] }
// GET /api/models?provider=openrouter
//   -> { models: [{ id, label, vision }] }
//
// Model ids move fast, so the settings screen reads the live catalogue
// straight from whichever provider the user configured instead of us
// shipping a list that goes stale.

import {
  PROVIDERS,
  PROVIDER_IDS,
  ProviderError,
  type ProviderId,
  apiKeyFor,
  isConfigured,
  resolveModel,
} from "./_lib/providers.js";
import { json, route } from "./_lib/http.js";
import { requireUser } from "./_lib/auth.js";

export type ModelInfo = {
  id: string;
  label: string;
  /** Undefined when the provider does not report modalities. */
  vision?: boolean;
};

async function fetchModels(id: ProviderId): Promise<ModelInfo[]> {
  const spec = PROVIDERS[id];
  const key = apiKeyFor(id);
  if (!key) {
    throw new ProviderError(`${spec.label} の API キーが未設定です`, 400, id);
  }

  const url =
    id === "anthropic"
      ? "https://api.anthropic.com/v1/models?limit=100"
      : `${spec.baseURL}/models`;

  const headers: Record<string, string> =
    id === "anthropic"
      ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
      : { authorization: `Bearer ${key}` };

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new ProviderError(
      `${spec.label} のモデル一覧を取得できませんでした (HTTP ${res.status})`,
      502,
      id,
    );
  }
  const body = (await res.json()) as { data?: unknown[] };
  const rows = Array.isArray(body.data) ? body.data : [];

  const models: ModelInfo[] = [];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string") continue;

    // OpenRouter is the only one that reports modalities; use it so the
    // photo screens can grey out text-only routes before a failed call.
    const architecture = r.architecture as
      | { input_modalities?: unknown }
      | undefined;
    const modalities = architecture?.input_modalities;

    models.push({
      id: r.id,
      label:
        (typeof r.display_name === "string" && r.display_name) ||
        (typeof r.name === "string" && r.name) ||
        r.id,
      // OpenRouter reports modalities; DeepSeek does not, and only its
      // vision-exp model can take an image, so the id has to answer for
      // it or the settings screen would offer text-only models for photos.
      vision: Array.isArray(modalities)
        ? modalities.includes("image")
        : id === "deepseek"
          ? /vision/i.test(r.id)
          : undefined,
    });
  }

  return models.sort((a, b) => a.id.localeCompare(b.id));
}

export const GET = route(async (request) => {
  await requireUser(request);

  const provider = new URL(request.url).searchParams.get("provider");

  if (!provider) {
    return json({
      providers: PROVIDER_IDS.map((id) => ({
        id,
        label: PROVIDERS[id].label,
        configured: isConfigured(id),
        vision: PROVIDERS[id].vision,
        docsUrl: PROVIDERS[id].docsUrl,
        defaultModel: resolveModel(id),
      })),
    });
  }

  if (!(PROVIDER_IDS as readonly string[]).includes(provider)) {
    throw new ProviderError(`未知のプロバイダです: ${provider}`, 400);
  }
  return json({ models: await fetchModels(provider as ProviderId) });
});
