// Body measurement from a single photo, entirely in the browser.
//
// Two MediaPipe models do the work:
//   * PoseLandmarker gives 33 body landmarks — shoulders, hips, ankles.
//     Those fix the skeleton, but skeletons have no width, so they cannot
//     tell a lean torso from a thick one.
//   * ImageSegmenter gives a person mask. Measuring the mask's run length
//     at the waist line is what turns "where the body is" into "how wide
//     the body is".
//
// Every ratio is divided by the subject's pixel height, so the numbers do
// not change when you stand closer to the camera. That is what makes two
// photos taken weeks apart comparable, and it is why these go to the LLM
// alongside the image rather than asking it to eyeball proportions.
//
// Everything here is best-effort: a photo that crops the legs simply
// returns null and the analysis proceeds without measurements.

import {
  FilesetResolver,
  ImageSegmenter,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const POSE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const SEGMENTER_MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite";

/** BlazePose indices we care about. */
const L = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftHip: 23,
  rightHip: 24,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

export type BodyMeasurements = {
  shoulderWidthRatio: number;
  hipWidthRatio: number;
  waistWidthRatio: number;
  /** False when the silhouette could not be read at waist height and the
   *  hip width stood in for it — the number is then not a waist at all,
   *  and saying so is better than quietly presenting a stand-in. */
  waistMeasured: boolean;
  shoulderToHipRatio: number;
  torsoLengthRatio: number;
  legLengthRatio: number;
};

let poseLandmarker: PoseLandmarker | null = null;
let segmenter: ImageSegmenter | null = null;
let loading: Promise<void> | null = null;

/** Loads both models once. ~8MB over the wire, so it is deliberately not
 *  called until the user actually opens the body screen. */
async function ensureModels(): Promise<void> {
  if (poseLandmarker && segmenter) return;
  loading ??= (async () => {
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
    [poseLandmarker, segmenter] = await Promise.all([
      PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: POSE_MODEL },
        runningMode: "IMAGE",
        numPoses: 1,
      }),
      ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: SEGMENTER_MODEL },
        runningMode: "IMAGE",
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      }),
    ]);
  })();
  await loading;
}

export class MeasureError extends Error {}

/**
 * Returns height-normalised body ratios, or throws `MeasureError` when the
 * photo does not contain a usable full-body pose.
 */
export async function measureBody(
  image: HTMLImageElement,
): Promise<BodyMeasurements> {
  await ensureModels();
  if (!poseLandmarker || !segmenter) {
    throw new MeasureError("解析モデルを読み込めませんでした");
  }

  const pose = poseLandmarker.detect(image);
  const landmarks = pose.landmarks?.[0];
  if (!landmarks) {
    throw new MeasureError(
      "写真から人物を検出できませんでした。全身が写るように撮り直してください",
    );
  }

  const at = (index: number): NormalizedLandmark => landmarks[index]!;
  const visible = (index: number) => (at(index).visibility ?? 1) > 0.5;

  if (!visible(L.leftShoulder) || !visible(L.rightShoulder)) {
    throw new MeasureError("肩が写っていません。全身が入るように撮ってください");
  }
  if (!visible(L.leftAnkle) && !visible(L.rightAnkle)) {
    throw new MeasureError(
      "足元が切れています。頭から足首まで入るように撮ってください",
    );
  }

  const midX = (a: number, b: number) => (at(a).x + at(b).x) / 2;
  const midY = (a: number, b: number) => (at(a).y + at(b).y) / 2;

  const shoulderY = midY(L.leftShoulder, L.rightShoulder);
  const hipY = midY(L.leftHip, L.rightHip);
  const ankleY = midY(L.leftAnkle, L.rightAnkle);
  const noseY = at(L.nose).y;

  // The crown is not a landmark. Nose-to-ankle covers roughly 0.88 of
  // standing height in adult proportions, so dividing by that recovers a
  // usable full-height reference without asking for a special pose.
  const pixelHeight = (ankleY - noseY) / 0.88;
  if (!(pixelHeight > 0.05)) {
    throw new MeasureError("姿勢を読み取れませんでした。正面を向いて撮り直してください");
  }

  const shoulderWidth = Math.abs(at(L.leftShoulder).x - at(L.rightShoulder).x);
  const hipWidth = Math.abs(at(L.leftHip).x - at(L.rightHip).x);

  // Waist: 40% of the way down from shoulders to hips is the narrowest
  // part of a typical torso and the place where fat gain shows first.
  const waistY = shoulderY + (hipY - shoulderY) * 0.4;
  const measuredWaist = measureMaskWidth(
    image,
    waistY,
    midX(L.leftHip, L.rightHip),
  );
  const waistWidth = measuredWaist ?? hipWidth;

  return {
    waistMeasured: measuredWaist !== null,
    shoulderWidthRatio: shoulderWidth / pixelHeight,
    hipWidthRatio: hipWidth / pixelHeight,
    waistWidthRatio: waistWidth / pixelHeight,
    shoulderToHipRatio: shoulderWidth / Math.max(1e-6, hipWidth),
    torsoLengthRatio: (hipY - shoulderY) / pixelHeight,
    legLengthRatio: (ankleY - hipY) / pixelHeight,
  };
}

/**
 * Width of the person mask on one horizontal line, in normalised units.
 * Scans outward from the body centre so a hand resting at the side or a
 * background object does not get counted as torso.
 */
function measureMaskWidth(
  image: HTMLImageElement,
  normalisedY: number,
  normalisedCentreX: number,
): number | null {
  if (!segmenter) return null;

  const result = segmenter.segment(image);
  const mask = result.categoryMask;
  if (!mask) {
    result.close();
    return null;
  }

  const width = mask.width;
  const height = mask.height;
  const data = mask.getAsUint8Array();

  const row = Math.round(normalisedY * height);
  if (row < 0 || row >= height) {
    result.close();
    return null;
  }

  const centre = Math.min(
    width - 1,
    Math.max(0, Math.round(normalisedCentreX * width)),
  );
  const rowOffset = row * width;
  // The selfie segmenter labels background 0 and person non-zero.
  const isPerson = (x: number) => data[rowOffset + x] !== 0;

  if (!isPerson(centre)) {
    result.close();
    return null;
  }

  let left = centre;
  while (left > 0 && isPerson(left - 1)) left--;
  let right = centre;
  while (right < width - 1 && isPerson(right + 1)) right++;

  result.close();
  return (right - left + 1) / width;
}

/** Frees the models. Called when the body screen unmounts so a long
 *  session does not hold ~8MB of WASM heap for a screen nobody is on. */
export function releaseModels(): void {
  poseLandmarker?.close();
  segmenter?.close();
  poseLandmarker = null;
  segmenter = null;
  loading = null;
}
