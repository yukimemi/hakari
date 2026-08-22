// Settings: which AI does which job, plus training preferences.
//
// Four tasks, five providers, and each provider's model list is fetched
// live rather than hardcoded — model ids change every few months and a
// stale dropdown is worse than no dropdown. Photo tasks only offer
// vision-capable choices, so the failure "DeepSeek cannot see images" is
// prevented in the UI instead of explained in an error.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth, useUid } from "../auth/context";
import { useSettings } from "../data/hooks";
import { saveSettings } from "../data/store";
import { api, ApiError, type ModelInfo, type ProviderStatus } from "../lib/api";
import {
  Alert,
  Button,
  Field,
  NumberInput,
  Panel,
  Select,
  TextInput,
} from "../components/ui";
import {
  AI_TASKS,
  AI_TASK_META,
  PROVIDER_META,
  type AiTask,
  type ProviderId,
} from "../../shared/providers";
import type { Equipment } from "../../shared/exercises";
import type { Settings } from "../../shared/schema";
import {
  cancelSpeech,
  japaneseVoices,
  preferredVoice,
  speak,
  speechSupported,
} from "../speech/speak";
import { isOwner } from "../../shared/access";
import InvitePanel from "./InvitePanel";

const EQUIPMENT_LABEL: Record<Equipment, string> = {
  none: "なし (自重のみ)",
  mat: "ヨガマット",
  dumbbell: "ダンベル",
  chair: "椅子",
};

/**
 * Which voice, and how high.
 *
 * "Cute" is not something an app can decide for someone, and the voices
 * available differ on every device — a Windows machine and a Pixel do not
 * ship the same set. So the app picks the best guess (a female Japanese
 * voice, never Ichiro) and then gets out of the way. The preview matters
 * more than the list: nobody can tell what "Microsoft Nanami" sounds like
 * by reading it.
 */
function VoicePicker({
  name,
  pitch,
  onChange,
}: {
  name?: string;
  pitch: number;
  onChange: (changes: { voiceName?: string; voicePitch?: number }) => void;
}) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (!speechSupported()) return;
    const read = () => setVoices(japaneseVoices());
    read();
    // Chrome populates the list asynchronously, and fires this when it does.
    window.speechSynthesis.addEventListener("voiceschanged", read);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", read);
      cancelSpeech();
    };
  }, []);

  if (!speechSupported()) {
    return (
      <p className="text-xs text-muted">
        この端末は音声合成に対応していません。
      </p>
    );
  }

  const current = preferredVoice(name);

  return (
    <div className="space-y-3 rounded-lg border border-rule/60 bg-sunk p-3">
      <Field
        label="声"
        hint={
          voices.length
            ? undefined
            : "端末が日本語の声を読み込み中です。少し待つか、再読み込みしてください。"
        }
      >
        <Select
          value={current?.name ?? ""}
          onChange={(e) => onChange({ voiceName: e.target.value || undefined })}
        >
          <option value="">おまかせ</option>
          {voices.map((voice) => (
            <option key={voice.name} value={voice.name}>
              {voice.name}
            </option>
          ))}
        </Select>
      </Field>

      <div>
        <div className="flex items-baseline justify-between">
          <span className="engraved">高さ</span>
          <span className="reading text-xs tabular-nums text-muted">
            {pitch.toFixed(2)}
          </span>
        </div>
        <input
          type="range"
          min="0.8"
          max="1.8"
          step="0.05"
          value={pitch}
          onChange={(e) => onChange({ voicePitch: Number(e.target.value) })}
          className="mt-1 w-full accent-[color:var(--needle)]"
        />
      </div>

      <Button
        className="w-full"
        onClick={() =>
          speak("こんにちは。今日も一緒にがんばりましょう！", {
            voiceName: current?.name,
            pitch,
          })
        }
      >
        試しに聞く
      </Button>
    </div>
  );
}

/** Order to fall back through, worst-to-best being the wrong way round:
 *  the hints in PROVIDER_META already say Claude reads portions most
 *  reliably and Gemini has the free tier to run every meal through, so
 *  prefer those over whichever provider happens to be declared first. */
const FALLBACK_ORDER: ProviderId[] = [
  "anthropic",
  "google",
  "openrouter",
  "openai",
  "deepseek",
];

/** The stored defaults name Claude for every task, which is the right
 *  answer only if there is a Claude key. Rather than opening on four
 *  broken assignments and a "モデル一覧を取得できませんでした" under each,
 *  move any task whose provider has no key onto one that does. This
 *  rewrites the *saved* values only — an explicit choice made this visit
 *  (`edits`) is layered on top afterwards and always wins. */
function withUsableProviders(
  settings: Settings,
  providers: ProviderStatus[],
): Settings {
  if (providers.length === 0) return settings;

  const ai = { ...settings.ai };
  let changed = false;

  for (const task of AI_TASKS) {
    const needsVision = AI_TASK_META[task].needsVision;
    const current = providers.find((p) => p.id === ai[task].provider);
    if (current?.configured && (!needsVision || current.vision)) continue;

    const fallback = FALLBACK_ORDER.map((id) =>
      providers.find((p) => p.id === id),
    ).find((p) => p?.configured && (!needsVision || p.vision));
    if (!fallback) continue;
    ai[task] = { provider: fallback.id };
    changed = true;
  }

  return changed ? { ...settings, ai } : settings;
}

export default function SettingsPage() {
  const uid = useUid();
  const { user, signOutUser } = useAuth();
  const { settings, loading } = useSettings();

  // `edits` holds only what the user has changed this visit; the form
  // reads through to the saved settings for everything else. That avoids
  // seeding state from a prop (which would either need a write inside an
  // effect, or would go stale when the snapshot updates).
  const [edits, setEdits] = useState<Partial<Settings> | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [models, setModels] = useState<Record<string, ModelInfo[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const draft: Settings | null = loading
    ? null
    : { ...withUsableProviders(settings, providers), ...edits };

  useEffect(() => {
    api
      .providers()
      .then((res) => setProviders(res.providers))
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : "プロバイダの状態を取得できませんでした",
        ),
      );
  }, []);

  /** Model lists are fetched on demand — one request per provider the
   *  user actually selects, cached for the session. */
  const loadModels = async (provider: ProviderId) => {
    if (models[provider]) return;
    try {
      const res = await api.models(provider);
      setModels((prev) => ({ ...prev, [provider]: res.models }));
    } catch {
      setModels((prev) => ({ ...prev, [provider]: [] }));
    }
  };

  const update = (changes: Partial<Settings>) =>
    setEdits((prev) => ({ ...prev, ...changes }));

  const save = async () => {
    if (!draft) return;
    setError(null);
    try {
      await saveSettings(uid, draft);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    }
  };

  if (!draft) return null;

  const configured = providers.filter((p) => p.configured);

  return (
    <>
      <Panel title="AI の割り当て">
        {error && <Alert tone="error">{error}</Alert>}

        {providers.length > 0 && configured.length === 0 && (
          <Alert tone="warn">
            使えるプロバイダがありません。Vercel の環境変数に API キーを
            1つ以上設定してください。
          </Alert>
        )}

        <div className="space-y-5">
          {AI_TASKS.map((task) => (
            <TaskRow
              key={task}
              task={task}
              value={draft.ai[task]}
              providers={providers}
              models={models}
              onFocusProvider={loadModels}
              onChange={(assignment) =>
                update({ ai: { ...draft.ai, [task]: assignment } })
              }
            />
          ))}
        </div>
      </Panel>

      <Panel title="キーの状態">
        <ul className="divide-y divide-rule/60 text-sm">
          {providers.map((provider) => (
            <li
              key={provider.id}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="font-medium">{provider.label}</p>
                <p className="truncate text-xs text-muted">
                  {PROVIDER_META[provider.id].hint}
                </p>
              </div>
              {provider.configured ? (
                <span className="shrink-0 text-xs text-goal">設定済み</span>
              ) : (
                <a
                  href={provider.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-xs text-muted underline"
                >
                  キーを取得
                </a>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          キーはサーバの環境変数にのみ置かれ、ブラウザには渡りません。
          Vercel のプロジェクト設定で{" "}
          <code className="rounded bg-sunk px-1">ANTHROPIC_API_KEY</code> などを
          設定してください。
        </p>
      </Panel>

      <Panel title="トレーニング">
        <div className="space-y-3">
          <Field label="使える器具">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(EQUIPMENT_LABEL) as Equipment[]).map((item) => {
                const active = draft.training.equipment.includes(item);
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() =>
                      update({
                        training: {
                          ...draft.training,
                          equipment: active
                            ? draft.training.equipment.filter((e) => e !== item)
                            : [...draft.training.equipment, item],
                        },
                      })
                    }
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      active
                        ? "border-ink bg-ink text-panel"
                        : "border-rule bg-panel text-muted"
                    }`}
                  >
                    {EQUIPMENT_LABEL[item]}
                  </button>
                );
              })}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="1回の時間">
              <NumberInput
                value={draft.training.minutesPerSession}
                suffix="分"
                onChange={(e) =>
                  update({
                    training: {
                      ...draft.training,
                      minutesPerSession: Number(e.target.value) || 20,
                    },
                  })
                }
              />
            </Field>
            <Field label="週の回数">
              <NumberInput
                value={draft.training.daysPerWeek}
                suffix="回"
                onChange={(e) =>
                  update({
                    training: {
                      ...draft.training,
                      daysPerWeek: Number(e.target.value) || 3,
                    },
                  })
                }
              />
            </Field>
          </div>

          <Field label="経験">
            <Select
              value={draft.training.experience}
              onChange={(e) =>
                update({
                  training: {
                    ...draft.training,
                    experience: e.target.value as Settings["training"]["experience"],
                  },
                })
              }
            >
              <option value="beginner">初心者 (運動習慣なし)</option>
              <option value="intermediate">中級 (週1-2回は動いている)</option>
              <option value="advanced">上級 (継続的にトレーニング中)</option>
            </Select>
          </Field>

          <Field
            label="制約"
            hint="膝が痛い、集合住宅で飛べない、など。メニュー生成で必ず考慮されます"
          >
            <TextInput
              value={draft.training.constraints}
              onChange={(e) =>
                update({
                  training: { ...draft.training, constraints: e.target.value },
                })
              }
              placeholder="例: 夜しかできないのでジャンプは不可"
            />
          </Field>
        </div>
      </Panel>

      <Panel title="アバター">
        <div className="space-y-3">
          <Field
            label="VRM ファイル"
            hint="public/avatars に置いたパス、または URL。未指定なら簡易モデルになります"
          >
            <TextInput
              value={draft.avatarSrc}
              onChange={(e) => update({ avatarSrc: e.target.value })}
              placeholder="/avatars/trainer.vrm"
            />
          </Field>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">音声で解説する</span>
            <input
              type="checkbox"
              checked={draft.voiceEnabled}
              onChange={(e) => update({ voiceEnabled: e.target.checked })}
              className="h-5 w-5 accent-[color:var(--needle)]"
            />
          </label>

          {draft.voiceEnabled && (
            <VoicePicker
              name={draft.voiceName}
              pitch={draft.voicePitch}
              onChange={update}
            />
          )}
        </div>
      </Panel>

      {isOwner(user?.email) && <InvitePanel />}

      <Panel title="アカウント">
        <div className="space-y-3">
          <Link
            to="/setup"
            className="block text-sm underline underline-offset-4"
          >
            身長・目標を編集する
          </Link>
          <Button onClick={signOutUser}>サインアウト</Button>
        </div>
      </Panel>

      {/* Plain and last, like every other form in the app. Sticking it to
          the viewport put it over the panel that was scrolling past, which
          read as the button having landed in the wrong place. */}
      <div>
        <Button variant="primary" size="lg" onClick={save}>
          {saved ? "保存しました" : "設定を保存"}
        </Button>
      </div>
    </>
  );
}

function TaskRow({
  task,
  value,
  providers,
  models,
  onFocusProvider,
  onChange,
}: {
  task: AiTask;
  value: { provider: ProviderId; model?: string };
  providers: ProviderStatus[];
  models: Record<string, ModelInfo[]>;
  onFocusProvider: (provider: ProviderId) => void;
  onChange: (assignment: { provider: ProviderId; model?: string }) => void;
}) {
  const meta = AI_TASK_META[task];
  const list = models[value.provider];

  useEffect(() => {
    onFocusProvider(value.provider);
    // Fetching the list for the currently selected provider is the only
    // dependency that matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.provider]);

  // For photo tasks, hide anything that cannot accept an image. OpenRouter
  // reports this per model; the rest report it per provider.
  const selectable = providers.filter(
    (provider) => !meta.needsVision || provider.vision,
  );
  const modelOptions = (list ?? []).filter(
    (model) => !meta.needsVision || model.vision !== false,
  );

  return (
    <div className="border-t border-rule/60 pt-4 first:border-t-0 first:pt-0">
      <p className="text-sm font-medium">{meta.label}</p>
      <p className="mb-2 text-xs text-muted">{meta.description}</p>

      <div className="grid grid-cols-[1.4fr_1fr] gap-2">
        <Select
          value={value.provider}
          onChange={(e) =>
            onChange({ provider: e.target.value as ProviderId, model: undefined })
          }
          aria-label={`${meta.label} のプロバイダ`}
        >
          {selectable.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
              {provider.configured ? "" : "（未設定）"}
            </option>
          ))}
        </Select>

        <Select
          value={value.model ?? ""}
          onChange={(e) =>
            onChange({ ...value, model: e.target.value || undefined })
          }
          aria-label={`${meta.label} のモデル`}
        >
          <option value="">既定のモデル</option>
          {modelOptions.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </Select>
      </div>

      {list && list.length === 0 && (
        <p className="mt-1.5 text-xs text-muted">
          モデル一覧を取得できませんでした。既定のモデルが使われます。
        </p>
      )}
    </div>
  );
}
