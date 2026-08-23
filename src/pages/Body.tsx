// Body screen: photo in, 3D read-out and a look at the goal state.
//
// The slider is the point of this screen. Seeing the figure at the target
// weight — reshaped in the places your own photo says you carry it — is a
// far better reason to keep going than a number on a chart.

import { useEffect, useMemo, useRef, useState } from "react";
import { useUid } from "../auth/context";
import { useBodyPhotos, useSettings, useUserDoc, useWeights } from "../data/hooks";
import {
  deleteBodyPhoto,
  saveBodyPhoto,
  saveUserSlice,
  saveWeight,
  updateBodyPhoto,
  uploadPhoto,
} from "../data/store";
import AvatarStage from "../avatar/AvatarStage";
import Scanning from "../components/Scanning";
import PhotoFilm from "../components/PhotoFilm";
import BodyTrend from "../components/BodyTrend";
import { lerpShape, projectShape, shapeFromBmi } from "../avatar/bodyShape";
import { measureBody, releaseModels, MeasureError, type BodyMeasurements } from "../vision/measure";
import { prepareImage } from "../lib/image";
import { api, ApiError } from "../lib/api";
import {
  Alert,
  Button,
  Field,
  NumberInput,
  Panel,
  Reading,
  TextInput,
} from "../components/ui";
import { formatKg } from "../lib/format";
import { ageFrom, bmi, todayKey } from "../../shared/calc";
import type { BodyAnalysis } from "../../shared/schema";

export default function Body() {
  const uid = useUid();
  const { settings } = useSettings();
  const { data: user } = useUserDoc();
  const { data: weights } = useWeights();
  const { data: photos } = useBodyPhotos();

  const profile = user.profile!;
  const goal = user.goal!;
  // The latest reading, which is not the same thing as today's. The
  // avatar, the analysis and the number stamped onto a photo all hang off
  // this one value, so which day it was taken on is part of the reading.
  const currentKg = weights.at(-1)?.weightKg ?? goal.startWeightKg;
  const weighedOn = weights.at(-1)?.date;
  const today = todayKey();

  // Until a photo has been analysed the avatar is still shaped by real
  // data — BMI — rather than being a default mannequin.
  const analysis = user.body;
  const currentShape = useMemo(
    () => analysis?.shape ?? shapeFromBmi(bmi(currentKg, profile.heightCm)),
    [analysis, currentKg, profile.heightCm],
  );
  const goalShape = useMemo(
    () => projectShape(currentShape, currentKg, goal.targetWeightKg),
    [currentShape, currentKg, goal.targetWeightKg],
  );

  const [morph, setMorph] = useState(0);
  // The bare figure by default: this screen is for reading a shape, and a
  // VRM's outfit is part of its mesh — a skirt hides the waist the whole
  // panel is about. The avatar is one tap away for when the point is
  // motivation rather than measurement.
  const [bare, setBare] = useState(true);
  const shownShape = useMemo(
    () => lerpShape(currentShape, goalShape, morph),
    [currentShape, goalShape, morph],
  );
  const shownKg = currentKg + (goal.targetWeightKg - currentKg) * morph;

  useEffect(() => releaseModels, []);

  return (
    <>
      <Panel
        title="いまの体"
        action={
          <div className="flex gap-1">
            {[
              { value: true, label: "素体" },
              { value: false, label: "アバター" },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => setBare(option.value)}
                className={`rounded-lg px-2 py-1 text-xs transition-colors ${
                  bare === option.value
                    ? "bg-sunk text-ink"
                    : "text-muted hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      >
        <div className="h-72 w-full overflow-hidden rounded-lg bg-sunk">
          <AvatarStage
            src={settings.avatarSrc}
            bare={bare}
            shape={shownShape}
            className="h-full w-full"
          />
        </div>

        <div className="mt-4">
          <div className="flex items-baseline justify-between">
            <span className="engraved">表示中</span>
            <span className="reading text-2xl font-bold">
              {formatKg(shownKg)}
              <span className="ml-1 text-xs font-medium text-muted">kg</span>
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={morph}
            onChange={(e) => setMorph(Number(e.target.value))}
            className="mt-2 w-full accent-[color:var(--needle)]"
            aria-label="現在の体型から目標体型へ"
          />
          <div className="flex justify-between text-xs text-muted">
            <span>
              今 {formatKg(currentKg)}kg
              <span className="ml-1">{weighedOnLabel(weighedOn, today)}</span>
            </span>
            <span>目標 {formatKg(goal.targetWeightKg)}kg</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            目標側の体型は、脂肪が落ちやすい部位から順に減らした推定です。
            正確な予測ではなく、変化の方向を見るためのものです。
          </p>
        </div>
      </Panel>

      {analysis && (
        <Panel title="読み取り結果">
          <div className="grid grid-cols-3 gap-3">
            <Reading label="体型タイプ" value={analysis.bodyType} size="sm" />
            <Reading
              label="推定体脂肪率"
              value={analysis.estimatedBodyFatPct.toFixed(1)}
              unit="%"
              size="sm"
            />
            {/* Absent on analyses stored before this field existed. */}
            <Reading
              label="推定ウエスト"
              value={analysis.estimatedWaistCm?.toFixed(1) ?? "—"}
              unit={analysis.estimatedWaistCm === undefined ? undefined : "cm"}
              size="sm"
            />
          </div>
          <p className="mt-3 text-sm leading-relaxed">{analysis.comment}</p>
          {analysis.focusAreas.length > 0 && (
            <div className="mt-3">
              <span className="engraved">重点部位</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {analysis.focusAreas.map((area) => (
                  <span
                    key={area}
                    className="rounded-full border border-rule bg-sunk px-2.5 py-1 text-xs"
                  >
                    {area}
                  </span>
                ))}
              </div>
            </div>
          )}
          {analysis.analyzedAt && (
            <p className="mt-3 text-xs text-muted">
              {analysis.analyzedAt} の写真から
            </p>
          )}
        </Panel>
      )}

      <BodyTrend photos={photos} />

      <BodyCapture
        heightCm={profile.heightCm}
        weightKg={currentKg}
        weighedOn={weighedOn}
        today={today}
        onWeighIn={(weightKg) => saveWeight(uid, { date: today, weightKg })}
        sex={profile.sex}
        age={ageFrom(profile.birthYear)}
        assignment={settings.ai.body}
        onDone={async (result, photoPath, date) => {
          await saveUserSlice(uid, {
            body: { ...result, photoPath, analyzedAt: date },
          });
          await saveBodyPhoto(uid, {
            date,
            photoPath,
            weightKg: currentKg,
            analysis: result,
          });
        }}
        uploadPhoto={(blob, name) => uploadPhoto(uid, "body", blob, name)}
      />

      {photos.length > 0 && (
        <PhotoFilm
          photos={photos}
          onSave={async (photo, patch) => {
            await updateBodyPhoto(uid, photo.id, patch);
            // The read-out names the day its photo was taken, so a
            // corrected date has to travel with it.
            if (analysis?.photoPath === photo.photoPath && patch.date !== photo.date) {
              await saveUserSlice(uid, { body: { ...analysis, analyzedAt: patch.date } });
            }
          }}
          onDelete={async (photo) => {
            await deleteBodyPhoto(uid, photo);
            // Deleting the photo a read-out came from has to take the
            // read-out with it, or the panel above keeps quoting a
            // picture that is no longer there. The most recent of the
            // photos left standing takes over.
            if (analysis?.photoPath !== photo.photoPath) return;
            const previous = photos
              .filter((p) => p.id !== photo.id && p.analysis)
              .at(-1);
            await saveUserSlice(uid, {
              body: previous?.analysis
                ? {
                    ...previous.analysis,
                    photoPath: previous.photoPath,
                    analyzedAt: previous.date,
                  }
                : undefined,
            });
          }}
        />
      )}
    </>
  );
}

/** "2026-08-20" → "08/20". The year is noise on a screen where every
 *  reading in play is from the last few weeks. */
function monthDay(date: string): string {
  return date.slice(5).replace("-", "/");
}

/** Where the weight on this screen came from. A reading taken four days
 *  ago is not wrong, but the screen must not let it pass for this
 *  morning's. */
function weighedOnLabel(weighedOn: string | undefined, today: string): string {
  if (!weighedOn) return "（開始時の値）";
  if (weighedOn === today) return "（今日）";
  return `（${monthDay(weighedOn)} の記録）`;
}

function BodyCapture({
  heightCm,
  weightKg,
  weighedOn,
  today,
  onWeighIn,
  sex,
  age,
  assignment,
  onDone,
  uploadPhoto: upload,
}: {
  heightCm: number;
  weightKg: number;
  /** The day `weightKg` was measured, or nothing when there is no reading
   *  at all and the goal's starting weight is standing in for one. */
  weighedOn?: string;
  today: string;
  onWeighIn: (weightKg: number) => Promise<void>;
  sex: "male" | "female";
  age: number;
  assignment: { provider: import("../../shared/providers").ProviderId; model?: string };
  onDone: (
    analysis: BodyAnalysis,
    photoPath: string,
    date: string,
  ) => Promise<void>;
  uploadPhoto: (blob: Blob, name: string) => Promise<string>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{
    url: string;
    blob: Blob;
    base64: string;
  } | null>(null);
  const [measurements, setMeasurements] = useState<BodyMeasurements | null>(null);
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<"idle" | "measuring" | "analyzing" | "saving">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [measureNote, setMeasureNote] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  const pick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    setMeasureNote(null);
    setMeasurements(null);
    setPhase("measuring");

    try {
      const prepared = await prepareImage(file);
      setPreview({
        url: prepared.previewUrl,
        blob: prepared.blob,
        base64: prepared.base64,
      });

      // Measure locally before spending an API call — the ratios go into
      // the prompt, and a photo that fails here is one the model would
      // have guessed at anyway.
      const image = new Image();
      image.src = prepared.previewUrl;
      await image.decode();
      setMeasurements(await measureBody(image));
    } catch (err) {
      if (err instanceof MeasureError) {
        setMeasureNote(err.message);
      } else {
        setError(
          err instanceof Error ? err.message : "写真を処理できませんでした",
        );
      }
    } finally {
      setPhase("idle");
    }
  };

  const analyze = async () => {
    if (!preview) return;
    setPhase("analyzing");
    setError(null);
    try {
      const res = await api.analyzeBody({
        image: { base64: preview.base64, mediaType: "image/jpeg" },
        assignment,
        heightCm,
        weightKg,
        sex,
        age,
        measurements: measurements ?? undefined,
        note: note.trim() || undefined,
      });

      setPhase("saving");
      const date = todayKey();
      const path = await upload(preview.blob, `${date}-${Date.now()}.jpg`);
      await onDone(res.analysis, path, date);

      URL.revokeObjectURL(preview.url);
      setPreview(null);
      setMeasurements(null);
      setNote("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "解析に失敗しました");
    } finally {
      setPhase("idle");
    }
  };

  return (
    <Panel title="写真から読み取る">
      {/* The weight is not decoration here: it goes into the prompt and is
          stamped onto the saved record, so a photo analysed before the
          morning weigh-in keeps the older number for good. */}
      <WeighIn
        weightKg={weightKg}
        weighedOn={weighedOn}
        today={today}
        onSave={onWeighIn}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={pick}
      />
      {/* A second input without `capture`: with it, a phone opens the camera
          and never offers the camera roll — which is what "選ぶ" promised. */}
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={pick}
      />

      {!preview && (
        <>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-rule-strong bg-sunk py-8 text-muted transition-colors hover:border-needle hover:text-ink"
        >
          <span className="text-sm font-medium">全身写真を撮る</span>
          <span className="max-w-xs text-center text-xs leading-relaxed">
            頭から足首まで入るように、正面から。
            体のラインが分かる服だと精度が上がります。
          </span>
        </button>
        <Button
          className="mt-3 w-full"
          onClick={() => libraryRef.current?.click()}
        >
          アルバムから選ぶ
        </Button>
        </>
      )}

      {preview && (
        <div className="space-y-3">
          <div className="relative mx-auto w-fit overflow-hidden rounded-lg border border-rule/60">
            <img src={preview.url} alt="全身写真" className="max-h-72" />
            {(phase === "measuring" || phase === "analyzing") && (
              <Scanning
                steps={
                  phase === "measuring"
                    ? ["骨格を読み取っています"]
                    : [
                        "実測値を渡しています",
                        "体型を推定しています",
                        "重点部位を選んでいます",
                        "まとめています",
                      ]
                }
              />
            )}
          </div>

          {measurements && (
            <div className="rounded-lg border border-rule/60 bg-sunk p-3">
              <div className="grid grid-cols-3 gap-2">
                <Reading
                  label="肩幅 / 身長"
                  value={(measurements.shoulderWidthRatio * 100).toFixed(1)}
                  unit="%"
                  size="sm"
                />
                <Reading
                  label="腰幅 / 身長"
                  value={(measurements.hipWidthRatio * 100).toFixed(1)}
                  unit="%"
                  size="sm"
                />
                <Reading
                  label="肩 ÷ 腰"
                  value={measurements.shoulderToHipRatio.toFixed(2)}
                  unit="倍"
                  size="sm"
                />
              </div>

              <p className="mt-3 text-xs leading-relaxed text-muted">
                骨格から測った<strong className="text-ink">幅と長さ</strong>を
                身長で割った値です。割ってあるのでカメラとの距離に左右されません。
                出ているのは関節の位置、つまり骨格なので、痩せてもほとんど
                変わりません。
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                この値は AI に渡していて、体型を「平均的な人」ではなく
                <strong className="text-ink">あなたの骨格</strong>に合わせて
                読ませるための基準です。ウエストの太さは骨格では測れないので、
                そこは AI が写真そのものから判断します。痩せた変化を見るのは
                <strong className="text-ink">体型の推移</strong>のほうです。
              </p>
            </div>
          )}

          {measureNote && <Alert tone="warn">{measureNote}</Alert>}

          <Field label="補足" hint="任意。気になる部位や、撮影時の条件など">
            <TextInput
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例: お腹周りが気になる"
            />
          </Field>

          {error && <Alert tone="error">{error}</Alert>}

          <div className="grid grid-cols-2 gap-3">
            <Button onClick={() => fileRef.current?.click()}>撮り直す</Button>
            <Button
              variant="primary"
              loading={phase === "analyzing" || phase === "saving"}
              onClick={analyze}
            >
              {phase === "analyzing"
                ? "解析中…"
                : phase === "saving"
                  ? "保存中…"
                  : "解析する"}
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

/** Today's weigh-in, offered where it matters. Analysing a photo reads the
 *  latest weight and stamps it onto the record it saves, and neither the
 *  reading nor the stamp is revisited afterwards — so the order genuinely
 *  matters, and this is the screen that has to say so. */
function WeighIn({
  weightKg,
  weighedOn,
  today,
  onSave,
}: {
  weightKg: number;
  weighedOn?: string;
  today: string;
  onSave: (weightKg: number) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const kg = Number(value);
    if (!kg) {
      setError("体重を入力してください");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(kg);
      setValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  if (weighedOn === today) {
    return (
      <p className="mb-3 text-xs text-muted">
        今日の{" "}
        <strong className="reading text-ink">{formatKg(weightKg)}kg</strong>{" "}
        で解析します。
      </p>
    );
  }

  return (
    <div className="mb-3 space-y-2">
      <Alert tone="warn">
        今日の体重がまだ記録されていません。このまま解析すると
        {weighedOn
          ? `${monthDay(weighedOn)} の ${formatKg(weightKg)}kg`
          : `開始時の ${formatKg(weightKg)}kg`}
        を使い、その値が写真にも残ります。
      </Alert>
      <form onSubmit={submit} className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <NumberInput
            value={value}
            onChange={(e) => setValue(e.target.value)}
            step="0.1"
            suffix="kg"
            placeholder="78.0"
            aria-label="今日の体重"
          />
        </div>
        <Button type="submit" variant="primary" loading={busy}>
          記録する
        </Button>
      </form>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
