// Photograph a meal, get it itemised, correct it, save it.
//
// The editable step is not optional polish: portion estimates from a
// photo are genuinely uncertain, and a log the user cannot correct is a
// log they stop trusting. The model's numbers arrive as a first draft
// with its confidence shown per item, and everything is editable before
// anything is written.

import { useEffect, useRef, useState } from "react";
import { useUid } from "../auth/context";
import { api, ApiError, type EncodedImage } from "../lib/api";
import { prepareImage } from "../lib/image";
import { saveMeal, uploadPhoto } from "../data/store";
import Scanning from "./Scanning";
import {
  Alert,
  Button,
  Field,
  NumberInput,
  Panel,
  Select,
  TextInput,
} from "./ui";
import { formatKcal } from "../lib/format";
import type {
  MealItem,
  MealSlot,
  TaskAssignment,
} from "../../shared/schema";

const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: "朝食",
  lunch: "昼食",
  dinner: "夕食",
  snack: "間食",
};

/** Storage object name. Kept out of the component so the timestamp is
 *  read at save time, never during render. */
function photoName(date: string, slot: MealSlot): string {
  return `${date}-${slot}-${Date.now()}.jpg`;
}

/** Whatever meal the clock says you are most likely logging. */
function defaultSlot(): MealSlot {
  const hour = new Date().getHours();
  if (hour < 10) return "breakfast";
  if (hour < 15) return "lunch";
  if (hour < 21) return "dinner";
  return "snack";
}

type Draft = MealItem & { confidence: number };

export default function MealCapture({
  date,
  assignment,
  onSaved,
  onCancel,
  autoOpen = false,
}: {
  date: string;
  assignment: TaskAssignment;
  onSaved: () => void;
  onCancel: () => void;
  autoOpen?: boolean;
}) {
  const uid = useUid();
  const fileRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const [image, setImage] = useState<
    (EncodedImage & { previewUrl: string; blob: Blob }) | null
  >(null);
  const [slot, setSlot] = useState<MealSlot>(defaultSlot());
  const [hint, setHint] = useState("");
  const [items, setItems] = useState<Draft[] | null>(null);
  const [advice, setAdvice] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "analyzing" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);

  // Opening straight into the camera is the whole point of the dashboard
  // shortcut — one tap from "I am about to eat" to a photo.
  useEffect(() => {
    if (autoOpen) fileRef.current?.click();
  }, [autoOpen]);

  useEffect(() => {
    return () => {
      if (image) URL.revokeObjectURL(image.previewUrl);
    };
  }, [image]);

  const pickFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    setItems(null);
    setAdvice(null);
    try {
      const prepared = await prepareImage(file);
      setImage({
        base64: prepared.base64,
        mediaType: prepared.mediaType,
        previewUrl: prepared.previewUrl,
        blob: prepared.blob,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "画像を読み込めませんでした");
    }
  };

  const analyze = async () => {
    if (!image) return;
    setPhase("analyzing");
    setError(null);
    try {
      const res = await api.analyzeMeal({
        image: { base64: image.base64, mediaType: image.mediaType },
        assignment,
        hint: hint.trim() || undefined,
      });
      setItems(
        res.analysis.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          kcal: Math.round(item.kcal),
          proteinG: Math.round(item.proteinG),
          fatG: Math.round(item.fatG),
          carbsG: Math.round(item.carbsG),
          confidence: item.confidence,
        })),
      );
      setAdvice(res.analysis.advice);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "解析に失敗しました");
    } finally {
      setPhase("idle");
    }
  };

  const totalKcal = (items ?? []).reduce((sum, item) => sum + item.kcal, 0);

  const save = async () => {
    if (!items?.length) return;
    setPhase("saving");
    setError(null);
    try {
      let photoPath: string | undefined;
      if (image) {
        photoPath = await uploadPhoto(uid, "meals", image.blob, photoName(date, slot));
      }
      await saveMeal(uid, {
        date,
        slot,
        items: items.map((draft) => ({
          name: draft.name,
          quantity: draft.quantity,
          kcal: draft.kcal,
          proteinG: draft.proteinG,
          fatG: draft.fatG,
          carbsG: draft.carbsG,
        })),
        totalKcal,
        photoPath,
        source: image ? "photo" : "manual",
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
      setPhase("idle");
    }
  };

  const patch = (index: number, changes: Partial<Draft>) =>
    setItems((prev) =>
      prev
        ? prev.map((item, i) => (i === index ? { ...item, ...changes } : item))
        : prev,
    );

  return (
    <Panel
      title={items ? "確認して保存" : "食事を記録"}
      action={
        <Button onClick={onCancel} className="text-muted">
          やめる
        </Button>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={pickFile}
      />
      {/* A second input without `capture`: with it, a phone opens the camera
          and never offers the camera roll — which is what "選ぶ" promised. */}
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={pickFile}
      />

      {!image && (
        <div className="space-y-3">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-rule-strong bg-sunk py-10 text-muted transition-colors hover:border-needle hover:text-ink"
          >
            <CameraIcon />
            <span className="text-sm font-medium">写真を撮る</span>
            <span className="text-xs">皿全体が入るように撮ると精度が上がります</span>
          </button>
          <Button onClick={() => libraryRef.current?.click()}>
            アルバムから選ぶ
          </Button>
          <Button
            onClick={() =>
              setItems([
                { name: "", quantity: "", kcal: 0, proteinG: 0, fatG: 0, carbsG: 0, confidence: 1 },
              ])
            }
          >
            写真なしで手入力する
          </Button>
        </div>
      )}

      {image && (
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-lg border border-rule/60">
            <img
              src={image.previewUrl}
              alt="撮影した食事"
              className="max-h-64 w-full object-cover"
            />
            {phase === "analyzing" && (
              <Scanning
                steps={[
                  "写真を読み込んでいます",
                  "料理を見分けています",
                  "分量を見積もっています",
                  "カロリーと PFC を計算しています",
                  "まとめています",
                ]}
              />
            )}
          </div>
          {!items && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="どの食事">
                  <Select
                    value={slot}
                    onChange={(e) => setSlot(e.target.value as MealSlot)}
                  >
                    {Object.entries(SLOT_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="撮り直す">
                  <Button onClick={() => fileRef.current?.click()} className="w-full">
                    別の写真
                  </Button>
                </Field>
              </div>
              <Field
                label="補足"
                hint="写真から分からないこと。例: ドレッシング多め、ごはん大盛り"
              >
                <TextInput
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                  placeholder="なければ空欄で"
                />
              </Field>
              <Button
                variant="primary"
                size="lg"
                loading={phase === "analyzing"}
                onClick={analyze}
              >
                {phase === "analyzing" ? "解析中…" : "カロリーを出す"}
              </Button>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {items && (
        <div className="mt-4 space-y-3">
          {advice && (
            <Alert tone="info">
              <span className="engraved mb-1 block">アドバイス</span>
              {advice}
            </Alert>
          )}

          {items.map((item, index) => (
            <div
              key={index}
              className="rounded-lg border border-rule/60 bg-sunk p-3"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-2">
                  <TextInput
                    value={item.name}
                    placeholder="料理名"
                    onChange={(e) => patch(index, { name: e.target.value })}
                  />
                  <TextInput
                    value={item.quantity}
                    placeholder="分量"
                    className="text-sm"
                    onChange={(e) => patch(index, { quantity: e.target.value })}
                  />
                </div>
                <button
                  onClick={() =>
                    setItems((prev) => prev?.filter((_, i) => i !== index) ?? null)
                  }
                  className="rounded-lg p-2 text-muted hover:text-needle"
                  aria-label={`${item.name || "この品目"}を削除`}
                >
                  <TrashIcon />
                </button>
              </div>

              {item.confidence < 0.5 && (
                <p className="mt-2 text-xs text-warn">
                  分量が読み取りにくい写真です。実際と違う場合は直してください。
                </p>
              )}

              <div className="mt-2 grid grid-cols-4 gap-2">
                {(
                  [
                    ["kcal", "kcal"],
                    ["proteinG", "P g"],
                    ["fatG", "F g"],
                    ["carbsG", "C g"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="block">
                    <span className="engraved block mb-1 text-[10px]">{label}</span>
                    <NumberInput
                      value={item[key]}
                      onChange={(e) =>
                        patch(index, { [key]: Number(e.target.value) || 0 })
                      }
                      className="!text-base !py-1.5"
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}

          <Button
            onClick={() =>
              setItems((prev) => [
                ...(prev ?? []),
                { name: "", quantity: "", kcal: 0, proteinG: 0, fatG: 0, carbsG: 0, confidence: 1 },
              ])
            }
          >
            品目を追加
          </Button>

          <div className="flex items-center justify-between border-t border-rule/60 pt-3">
            <div>
              <span className="engraved">合計</span>
              <div className="reading text-3xl font-bold">
                {formatKcal(totalKcal)}
                <span className="ml-1 text-sm font-medium text-muted">kcal</span>
              </div>
            </div>
            <Select
              value={slot}
              onChange={(e) => setSlot(e.target.value as MealSlot)}
              className="!w-auto"
            >
              {Object.entries(SLOT_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>

          <Button
            variant="primary"
            size="lg"
            loading={phase === "saving"}
            disabled={!items.some((item) => item.name.trim())}
            onClick={save}
          >
            記録する
          </Button>
        </div>
      )}
    </Panel>
  );
}

function CameraIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}
