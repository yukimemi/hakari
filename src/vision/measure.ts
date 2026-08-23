// Body measurement from a single photo, entirely in the browser.
//
// MediaPipe's PoseLandmarker gives 33 body landmarks — shoulders, hips,
// ankles. Those fix the skeleton: how wide the frame is, how long the
// torso and the legs are. Every ratio is divided by the subject's pixel
// height, so the numbers do not change when you stand closer to the
// camera.
//
// What is deliberately *not* measured here is the waist. Reading a waist
// needs a silhouette, not joints, and the only in-browser model for that
// is the selfie segmenter — which Google specifies for subjects under 2m
// from the camera. A photo framed head-to-ankle puts the subject well
// outside that range, so the mask came back unusable at waist height on
// essentially every photo and the code quietly substituted the hip width.
// The waist is now left to the vision model, which sees the silhouette
// directly — which is what was happening in practice anyway.
//
// One consequence worth keeping in mind: what remains is bone geometry.
// These ratios barely move as fat comes off, so they are an anchor that
// stops the model sizing the avatar against a generic body — not a
// progress metric. Progress is tracked from the analysis history.
//
// Everything here is best-effort: a photo that crops the legs simply
// throws and the analysis proceeds without measurements.

import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const POSE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

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
  shoulderToHipRatio: number;
  torsoLengthRatio: number;
  legLengthRatio: number;
};

let poseLandmarker: PoseLandmarker | null = null;
let loading: Promise<void> | null = null;

/** Loads the pose model once. A few MB over the wire, so it is
 *  deliberately not called until the user opens the body screen. */
async function ensureModels(): Promise<void> {
  if (poseLandmarker) return;
  loading ??= (async () => {
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: POSE_MODEL },
      runningMode: "IMAGE",
      numPoses: 1,
    });
  })();
  await loading;
}

export class MeasureError extends Error {}

/**
 * Returns height-normalised skeleton ratios, or throws `MeasureError` when
 * the photo does not contain a usable full-body pose.
 */
export async function measureBody(
  image: HTMLImageElement,
): Promise<BodyMeasurements> {
  await ensureModels();
  if (!poseLandmarker) {
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

  return {
    shoulderWidthRatio: shoulderWidth / pixelHeight,
    hipWidthRatio: hipWidth / pixelHeight,
    shoulderToHipRatio: shoulderWidth / Math.max(1e-6, hipWidth),
    torsoLengthRatio: (hipY - shoulderY) / pixelHeight,
    legLengthRatio: (ankleY - hipY) / pixelHeight,
  };
}

/** Frees the model. Called when the body screen unmounts so a long
 *  session does not hold the WASM heap for a screen nobody is on. */
export function releaseModels(): void {
  poseLandmarker?.close();
  poseLandmarker = null;
  loading = null;
}
