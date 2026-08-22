// Procedural exercise motion for the VRM humanoid.
//
// Why not just play Mixamo clips? Because Mixamo assets cannot be
// redistributed, so a build that depends on them ships an avatar that
// stands still for every user who has not gone and downloaded the FBX
// themselves. These keyframes are the floor: coarse next to mocap, but
// they always run, and they communicate the movement pattern — which is
// the entire job of a demonstration.
//
// `src/avatar/gesture.ts` prefers a real clip whenever one is present in
// `public/motions/`; this module is what plays otherwise.
//
// Angles are radians on the VRM normalized humanoid, where a bone at
// (0,0,0) is the T-pose rest. Sign conventions follow VRM 1.0: the model
// faces +Z, positive X rotation on a leg bone swings it forward.

import { VRMHumanBoneName as B } from "@pixiv/three-vrm";

export type BonePose = Partial<Record<VRMHumanBoneName_, Euler3>>;
type VRMHumanBoneName_ = (typeof B)[keyof typeof B];
export type Euler3 = [number, number, number];

export type Keyframe = {
  /** Normalised time in the loop, 0..1. Must be ascending. */
  t: number;
  pose: BonePose;
  /** Metres, relative to the rest hip position. */
  hips?: Euler3;
};

export type Motion = {
  /** Whole-body orientation the exercise happens in. */
  base: "standing" | "prone" | "supine";
  /** One repetition in seconds. */
  loopSec: number;
  frames: Keyframe[];
};

const DEG = Math.PI / 180;

/** Arms held out for a floor plank / push-up: shoulders under hands. */
const PRONE_ARMS: BonePose = {
  [B.LeftUpperArm]: [0, 0, 75 * DEG],
  [B.RightUpperArm]: [0, 0, -75 * DEG],
  [B.LeftLowerArm]: [0, 0, 0],
  [B.RightLowerArm]: [0, 0, 0],
};

const ARMS_DOWN: BonePose = {
  [B.LeftUpperArm]: [0, 0, 70 * DEG],
  [B.RightUpperArm]: [0, 0, -70 * DEG],
};

export const MOTIONS: Record<string, Motion> = {
  squat: {
    base: "standing",
    loopSec: 3,
    frames: [
      {
        t: 0,
        pose: { ...ARMS_DOWN },
        hips: [0, 0, 0],
      },
      {
        t: 0.45,
        pose: {
          ...ARMS_DOWN,
          // Arms come forward as a counterweight, as they do in a real squat.
          [B.LeftUpperArm]: [70 * DEG, 0, 70 * DEG],
          [B.RightUpperArm]: [70 * DEG, 0, -70 * DEG],
          [B.LeftUpperLeg]: [80 * DEG, 0, 0],
          [B.RightUpperLeg]: [80 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-95 * DEG, 0, 0],
          [B.RightLowerLeg]: [-95 * DEG, 0, 0],
          [B.LeftFoot]: [20 * DEG, 0, 0],
          [B.RightFoot]: [20 * DEG, 0, 0],
          [B.Spine]: [15 * DEG, 0, 0],
        },
        hips: [0, -0.34, 0],
      },
      { t: 1, pose: { ...ARMS_DOWN }, hips: [0, 0, 0] },
    ],
  },

  lunge: {
    base: "standing",
    loopSec: 3.4,
    frames: [
      { t: 0, pose: { ...ARMS_DOWN }, hips: [0, 0, 0] },
      {
        t: 0.5,
        pose: {
          ...ARMS_DOWN,
          [B.LeftUpperLeg]: [55 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-80 * DEG, 0, 0],
          [B.RightUpperLeg]: [-25 * DEG, 0, 0],
          [B.RightLowerLeg]: [-75 * DEG, 0, 0],
          [B.Spine]: [4 * DEG, 0, 0],
        },
        hips: [0, -0.26, 0.08],
      },
      { t: 1, pose: { ...ARMS_DOWN }, hips: [0, 0, 0] },
    ],
  },

  "calf-raise": {
    base: "standing",
    loopSec: 2,
    frames: [
      { t: 0, pose: { ...ARMS_DOWN }, hips: [0, 0, 0] },
      {
        t: 0.5,
        pose: {
          ...ARMS_DOWN,
          [B.LeftFoot]: [-30 * DEG, 0, 0],
          [B.RightFoot]: [-30 * DEG, 0, 0],
        },
        hips: [0, 0.06, 0],
      },
      { t: 1, pose: { ...ARMS_DOWN }, hips: [0, 0, 0] },
    ],
  },

  "jumping-jack": {
    base: "standing",
    loopSec: 1.2,
    frames: [
      { t: 0, pose: { ...ARMS_DOWN }, hips: [0, 0, 0] },
      {
        t: 0.5,
        pose: {
          [B.LeftUpperArm]: [0, 0, -10 * DEG],
          [B.RightUpperArm]: [0, 0, 10 * DEG],
          [B.LeftUpperLeg]: [0, 0, -18 * DEG],
          [B.RightUpperLeg]: [0, 0, 18 * DEG],
        },
        hips: [0, 0.04, 0],
      },
      { t: 1, pose: { ...ARMS_DOWN }, hips: [0, 0, 0] },
    ],
  },

  "high-knees": {
    base: "standing",
    loopSec: 1,
    frames: [
      {
        t: 0,
        pose: {
          [B.LeftUpperLeg]: [90 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-80 * DEG, 0, 0],
          [B.RightUpperArm]: [80 * DEG, 0, -60 * DEG],
          [B.LeftUpperArm]: [-30 * DEG, 0, 60 * DEG],
        },
      },
      {
        t: 0.5,
        pose: {
          [B.RightUpperLeg]: [90 * DEG, 0, 0],
          [B.RightLowerLeg]: [-80 * DEG, 0, 0],
          [B.LeftUpperArm]: [80 * DEG, 0, 60 * DEG],
          [B.RightUpperArm]: [-30 * DEG, 0, -60 * DEG],
        },
      },
      {
        t: 1,
        pose: {
          [B.LeftUpperLeg]: [90 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-80 * DEG, 0, 0],
          [B.RightUpperArm]: [80 * DEG, 0, -60 * DEG],
          [B.LeftUpperArm]: [-30 * DEG, 0, 60 * DEG],
        },
      },
    ],
  },

  walk: {
    base: "standing",
    loopSec: 1.1,
    frames: [
      {
        t: 0,
        pose: {
          [B.LeftUpperLeg]: [28 * DEG, 0, 0],
          [B.RightUpperLeg]: [-22 * DEG, 0, 0],
          [B.RightLowerLeg]: [-18 * DEG, 0, 0],
          [B.LeftUpperArm]: [-22 * DEG, 0, 68 * DEG],
          [B.RightUpperArm]: [22 * DEG, 0, -68 * DEG],
        },
      },
      {
        t: 0.5,
        pose: {
          [B.RightUpperLeg]: [28 * DEG, 0, 0],
          [B.LeftUpperLeg]: [-22 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-18 * DEG, 0, 0],
          [B.RightUpperArm]: [-22 * DEG, 0, -68 * DEG],
          [B.LeftUpperArm]: [22 * DEG, 0, 68 * DEG],
        },
      },
      {
        t: 1,
        pose: {
          [B.LeftUpperLeg]: [28 * DEG, 0, 0],
          [B.RightUpperLeg]: [-22 * DEG, 0, 0],
          [B.RightLowerLeg]: [-18 * DEG, 0, 0],
          [B.LeftUpperArm]: [-22 * DEG, 0, 68 * DEG],
          [B.RightUpperArm]: [22 * DEG, 0, -68 * DEG],
        },
      },
    ],
  },

  pushup: {
    base: "prone",
    loopSec: 2.6,
    frames: [
      { t: 0, pose: { ...PRONE_ARMS }, hips: [0, 0, 0] },
      {
        t: 0.5,
        pose: {
          ...PRONE_ARMS,
          [B.LeftLowerArm]: [0, -70 * DEG, 0],
          [B.RightLowerArm]: [0, 70 * DEG, 0],
        },
        hips: [0, -0.16, 0],
      },
      { t: 1, pose: { ...PRONE_ARMS }, hips: [0, 0, 0] },
    ],
  },

  "knee-pushup": {
    base: "prone",
    loopSec: 2.6,
    frames: [
      {
        t: 0,
        pose: {
          ...PRONE_ARMS,
          [B.LeftLowerLeg]: [-80 * DEG, 0, 0],
          [B.RightLowerLeg]: [-80 * DEG, 0, 0],
        },
        hips: [0, 0, 0],
      },
      {
        t: 0.5,
        pose: {
          ...PRONE_ARMS,
          [B.LeftLowerArm]: [0, -70 * DEG, 0],
          [B.RightLowerArm]: [0, 70 * DEG, 0],
          [B.LeftLowerLeg]: [-80 * DEG, 0, 0],
          [B.RightLowerLeg]: [-80 * DEG, 0, 0],
        },
        hips: [0, -0.14, 0],
      },
      {
        t: 1,
        pose: {
          ...PRONE_ARMS,
          [B.LeftLowerLeg]: [-80 * DEG, 0, 0],
          [B.RightLowerLeg]: [-80 * DEG, 0, 0],
        },
        hips: [0, 0, 0],
      },
    ],
  },

  plank: {
    base: "prone",
    loopSec: 4,
    frames: [
      {
        t: 0,
        pose: {
          [B.LeftUpperArm]: [0, 0, 78 * DEG],
          [B.RightUpperArm]: [0, 0, -78 * DEG],
          [B.LeftLowerArm]: [0, -80 * DEG, 0],
          [B.RightLowerArm]: [0, 80 * DEG, 0],
        },
        hips: [0, -0.06, 0],
      },
      // Held, with only breathing motion — a static hold should look held.
      {
        t: 0.5,
        pose: {
          [B.LeftUpperArm]: [0, 0, 78 * DEG],
          [B.RightUpperArm]: [0, 0, -78 * DEG],
          [B.LeftLowerArm]: [0, -80 * DEG, 0],
          [B.RightLowerArm]: [0, 80 * DEG, 0],
          [B.Chest]: [2 * DEG, 0, 0],
        },
        hips: [0, -0.05, 0],
      },
      {
        t: 1,
        pose: {
          [B.LeftUpperArm]: [0, 0, 78 * DEG],
          [B.RightUpperArm]: [0, 0, -78 * DEG],
          [B.LeftLowerArm]: [0, -80 * DEG, 0],
          [B.RightLowerArm]: [0, 80 * DEG, 0],
        },
        hips: [0, -0.06, 0],
      },
    ],
  },

  "mountain-climber": {
    base: "prone",
    loopSec: 1.1,
    frames: [
      {
        t: 0,
        pose: {
          ...PRONE_ARMS,
          [B.LeftUpperLeg]: [70 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-70 * DEG, 0, 0],
        },
      },
      {
        t: 0.5,
        pose: {
          ...PRONE_ARMS,
          [B.RightUpperLeg]: [70 * DEG, 0, 0],
          [B.RightLowerLeg]: [-70 * DEG, 0, 0],
        },
      },
      {
        t: 1,
        pose: {
          ...PRONE_ARMS,
          [B.LeftUpperLeg]: [70 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-70 * DEG, 0, 0],
        },
      },
    ],
  },

  crunch: {
    base: "supine",
    loopSec: 2.4,
    frames: [
      {
        t: 0,
        pose: {
          [B.LeftUpperLeg]: [60 * DEG, 0, 0],
          [B.RightUpperLeg]: [60 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-80 * DEG, 0, 0],
          [B.RightLowerLeg]: [-80 * DEG, 0, 0],
          [B.LeftUpperArm]: [110 * DEG, 0, 55 * DEG],
          [B.RightUpperArm]: [110 * DEG, 0, -55 * DEG],
          [B.LeftLowerArm]: [0, -90 * DEG, 0],
          [B.RightLowerArm]: [0, 90 * DEG, 0],
        },
      },
      {
        t: 0.45,
        pose: {
          [B.LeftUpperLeg]: [60 * DEG, 0, 0],
          [B.RightUpperLeg]: [60 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-80 * DEG, 0, 0],
          [B.RightLowerLeg]: [-80 * DEG, 0, 0],
          [B.LeftUpperArm]: [110 * DEG, 0, 55 * DEG],
          [B.RightUpperArm]: [110 * DEG, 0, -55 * DEG],
          [B.LeftLowerArm]: [0, -90 * DEG, 0],
          [B.RightLowerArm]: [0, 90 * DEG, 0],
          [B.Spine]: [30 * DEG, 0, 0],
          [B.Chest]: [15 * DEG, 0, 0],
        },
      },
      {
        t: 1,
        pose: {
          [B.LeftUpperLeg]: [60 * DEG, 0, 0],
          [B.RightUpperLeg]: [60 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-80 * DEG, 0, 0],
          [B.RightLowerLeg]: [-80 * DEG, 0, 0],
          [B.LeftUpperArm]: [110 * DEG, 0, 55 * DEG],
          [B.RightUpperArm]: [110 * DEG, 0, -55 * DEG],
          [B.LeftLowerArm]: [0, -90 * DEG, 0],
          [B.RightLowerArm]: [0, 90 * DEG, 0],
        },
      },
    ],
  },

  "glute-bridge": {
    base: "supine",
    loopSec: 2.6,
    frames: [
      {
        t: 0,
        pose: {
          [B.LeftUpperLeg]: [55 * DEG, 0, 0],
          [B.RightUpperLeg]: [55 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-85 * DEG, 0, 0],
          [B.RightLowerLeg]: [-85 * DEG, 0, 0],
        },
        hips: [0, 0, 0],
      },
      {
        t: 0.5,
        pose: {
          [B.LeftUpperLeg]: [30 * DEG, 0, 0],
          [B.RightUpperLeg]: [30 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-70 * DEG, 0, 0],
          [B.RightLowerLeg]: [-70 * DEG, 0, 0],
          [B.Spine]: [-12 * DEG, 0, 0],
        },
        hips: [0, 0.16, 0],
      },
      {
        t: 1,
        pose: {
          [B.LeftUpperLeg]: [55 * DEG, 0, 0],
          [B.RightUpperLeg]: [55 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-85 * DEG, 0, 0],
          [B.RightLowerLeg]: [-85 * DEG, 0, 0],
        },
        hips: [0, 0, 0],
      },
    ],
  },

  "dead-bug": {
    base: "supine",
    loopSec: 3.2,
    frames: [
      {
        t: 0,
        pose: {
          [B.LeftUpperLeg]: [90 * DEG, 0, 0],
          [B.RightUpperLeg]: [90 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-90 * DEG, 0, 0],
          [B.RightLowerLeg]: [-90 * DEG, 0, 0],
          [B.LeftUpperArm]: [160 * DEG, 0, 80 * DEG],
          [B.RightUpperArm]: [160 * DEG, 0, -80 * DEG],
        },
      },
      {
        t: 0.5,
        pose: {
          [B.LeftUpperLeg]: [15 * DEG, 0, 0],
          [B.RightUpperLeg]: [90 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-10 * DEG, 0, 0],
          [B.RightLowerLeg]: [-90 * DEG, 0, 0],
          [B.LeftUpperArm]: [160 * DEG, 0, 80 * DEG],
          [B.RightUpperArm]: [40 * DEG, 0, -80 * DEG],
        },
      },
      {
        t: 1,
        pose: {
          [B.LeftUpperLeg]: [90 * DEG, 0, 0],
          [B.RightUpperLeg]: [90 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-90 * DEG, 0, 0],
          [B.RightLowerLeg]: [-90 * DEG, 0, 0],
          [B.LeftUpperArm]: [160 * DEG, 0, 80 * DEG],
          [B.RightUpperArm]: [160 * DEG, 0, -80 * DEG],
        },
      },
    ],
  },

  "russian-twist": {
    base: "supine",
    loopSec: 2,
    frames: [
      {
        t: 0,
        pose: {
          [B.Spine]: [55 * DEG, 35 * DEG, 0],
          [B.LeftUpperLeg]: [50 * DEG, 0, 0],
          [B.RightUpperLeg]: [50 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-70 * DEG, 0, 0],
          [B.RightLowerLeg]: [-70 * DEG, 0, 0],
          [B.LeftUpperArm]: [95 * DEG, 0, 40 * DEG],
          [B.RightUpperArm]: [95 * DEG, 0, -40 * DEG],
        },
      },
      {
        t: 0.5,
        pose: {
          [B.Spine]: [55 * DEG, -35 * DEG, 0],
          [B.LeftUpperLeg]: [50 * DEG, 0, 0],
          [B.RightUpperLeg]: [50 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-70 * DEG, 0, 0],
          [B.RightLowerLeg]: [-70 * DEG, 0, 0],
          [B.LeftUpperArm]: [95 * DEG, 0, 40 * DEG],
          [B.RightUpperArm]: [95 * DEG, 0, -40 * DEG],
        },
      },
      {
        t: 1,
        pose: {
          [B.Spine]: [55 * DEG, 35 * DEG, 0],
          [B.LeftUpperLeg]: [50 * DEG, 0, 0],
          [B.RightUpperLeg]: [50 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-70 * DEG, 0, 0],
          [B.RightLowerLeg]: [-70 * DEG, 0, 0],
          [B.LeftUpperArm]: [95 * DEG, 0, 40 * DEG],
          [B.RightUpperArm]: [95 * DEG, 0, -40 * DEG],
        },
      },
    ],
  },

  superman: {
    base: "prone",
    loopSec: 2.8,
    frames: [
      {
        t: 0,
        pose: {
          [B.LeftUpperArm]: [155 * DEG, 0, 80 * DEG],
          [B.RightUpperArm]: [155 * DEG, 0, -80 * DEG],
        },
        hips: [0, -0.1, 0],
      },
      {
        t: 0.5,
        pose: {
          [B.LeftUpperArm]: [165 * DEG, 0, 80 * DEG],
          [B.RightUpperArm]: [165 * DEG, 0, -80 * DEG],
          [B.Spine]: [-18 * DEG, 0, 0],
          [B.Chest]: [-10 * DEG, 0, 0],
          [B.LeftUpperLeg]: [-20 * DEG, 0, 0],
          [B.RightUpperLeg]: [-20 * DEG, 0, 0],
        },
        hips: [0, -0.1, 0],
      },
      {
        t: 1,
        pose: {
          [B.LeftUpperArm]: [155 * DEG, 0, 80 * DEG],
          [B.RightUpperArm]: [155 * DEG, 0, -80 * DEG],
        },
        hips: [0, -0.1, 0],
      },
    ],
  },

  "side-plank": {
    base: "prone",
    loopSec: 4,
    frames: [
      {
        t: 0,
        pose: {
          [B.Spine]: [0, 0, 0],
          [B.LeftUpperArm]: [0, 0, 80 * DEG],
          [B.RightUpperArm]: [0, 0, -160 * DEG],
        },
        hips: [0, -0.05, 0],
      },
      {
        t: 1,
        pose: {
          [B.Spine]: [0, 0, 0],
          [B.LeftUpperArm]: [0, 0, 80 * DEG],
          [B.RightUpperArm]: [0, 0, -160 * DEG],
        },
        hips: [0, -0.04, 0],
      },
    ],
  },

  burpee: {
    base: "standing",
    loopSec: 3.6,
    frames: [
      { t: 0, pose: { ...ARMS_DOWN }, hips: [0, 0, 0] },
      {
        t: 0.3,
        pose: {
          [B.LeftUpperLeg]: [95 * DEG, 0, 0],
          [B.RightUpperLeg]: [95 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-110 * DEG, 0, 0],
          [B.RightLowerLeg]: [-110 * DEG, 0, 0],
          [B.Spine]: [45 * DEG, 0, 0],
          [B.LeftUpperArm]: [80 * DEG, 0, 70 * DEG],
          [B.RightUpperArm]: [80 * DEG, 0, -70 * DEG],
        },
        hips: [0, -0.45, 0],
      },
      {
        t: 0.55,
        pose: {
          [B.Spine]: [70 * DEG, 0, 0],
          [B.LeftUpperArm]: [90 * DEG, 0, 70 * DEG],
          [B.RightUpperArm]: [90 * DEG, 0, -70 * DEG],
          [B.LeftUpperLeg]: [-10 * DEG, 0, 0],
          [B.RightUpperLeg]: [-10 * DEG, 0, 0],
        },
        hips: [0, -0.55, 0.1],
      },
      {
        t: 0.85,
        pose: {
          ...ARMS_DOWN,
          [B.LeftUpperArm]: [170 * DEG, 0, 70 * DEG],
          [B.RightUpperArm]: [170 * DEG, 0, -70 * DEG],
        },
        hips: [0, 0.12, 0],
      },
      { t: 1, pose: { ...ARMS_DOWN }, hips: [0, 0, 0] },
    ],
  },

  "chair-dip": {
    base: "standing",
    loopSec: 2.6,
    frames: [
      {
        t: 0,
        pose: {
          [B.LeftUpperArm]: [-40 * DEG, 0, 100 * DEG],
          [B.RightUpperArm]: [-40 * DEG, 0, -100 * DEG],
          [B.LeftUpperLeg]: [80 * DEG, 0, 0],
          [B.RightUpperLeg]: [80 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-20 * DEG, 0, 0],
          [B.RightLowerLeg]: [-20 * DEG, 0, 0],
        },
        hips: [0, -0.35, 0.1],
      },
      {
        t: 0.5,
        pose: {
          [B.LeftUpperArm]: [-40 * DEG, 0, 100 * DEG],
          [B.RightUpperArm]: [-40 * DEG, 0, -100 * DEG],
          [B.LeftLowerArm]: [0, -75 * DEG, 0],
          [B.RightLowerArm]: [0, 75 * DEG, 0],
          [B.LeftUpperLeg]: [80 * DEG, 0, 0],
          [B.RightUpperLeg]: [80 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-20 * DEG, 0, 0],
          [B.RightLowerLeg]: [-20 * DEG, 0, 0],
        },
        hips: [0, -0.5, 0.1],
      },
      {
        t: 1,
        pose: {
          [B.LeftUpperArm]: [-40 * DEG, 0, 100 * DEG],
          [B.RightUpperArm]: [-40 * DEG, 0, -100 * DEG],
          [B.LeftUpperLeg]: [80 * DEG, 0, 0],
          [B.RightUpperLeg]: [80 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-20 * DEG, 0, 0],
          [B.RightLowerLeg]: [-20 * DEG, 0, 0],
        },
        hips: [0, -0.35, 0.1],
      },
    ],
  },

  "dumbbell-row": {
    base: "standing",
    loopSec: 2.4,
    frames: [
      {
        t: 0,
        pose: {
          [B.Spine]: [55 * DEG, 0, 0],
          [B.LeftUpperArm]: [-55 * DEG, 0, 78 * DEG],
          [B.RightUpperArm]: [-55 * DEG, 0, -78 * DEG],
          [B.LeftUpperLeg]: [15 * DEG, 0, 0],
          [B.RightUpperLeg]: [15 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-20 * DEG, 0, 0],
          [B.RightLowerLeg]: [-20 * DEG, 0, 0],
        },
        hips: [0, -0.12, 0],
      },
      {
        t: 0.5,
        pose: {
          [B.Spine]: [55 * DEG, 0, 0],
          [B.LeftUpperArm]: [-55 * DEG, 0, 78 * DEG],
          [B.RightUpperArm]: [-55 * DEG, 0, -78 * DEG],
          [B.LeftLowerArm]: [0, -95 * DEG, 0],
          [B.RightLowerArm]: [0, 95 * DEG, 0],
          [B.LeftUpperLeg]: [15 * DEG, 0, 0],
          [B.RightUpperLeg]: [15 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-20 * DEG, 0, 0],
          [B.RightLowerLeg]: [-20 * DEG, 0, 0],
        },
        hips: [0, -0.12, 0],
      },
      {
        t: 1,
        pose: {
          [B.Spine]: [55 * DEG, 0, 0],
          [B.LeftUpperArm]: [-55 * DEG, 0, 78 * DEG],
          [B.RightUpperArm]: [-55 * DEG, 0, -78 * DEG],
          [B.LeftUpperLeg]: [15 * DEG, 0, 0],
          [B.RightUpperLeg]: [15 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-20 * DEG, 0, 0],
          [B.RightLowerLeg]: [-20 * DEG, 0, 0],
        },
        hips: [0, -0.12, 0],
      },
    ],
  },

  "dumbbell-press": {
    base: "standing",
    loopSec: 2.4,
    frames: [
      {
        t: 0,
        pose: {
          [B.LeftUpperArm]: [0, 0, 10 * DEG],
          [B.RightUpperArm]: [0, 0, -10 * DEG],
          [B.LeftLowerArm]: [0, -85 * DEG, 0],
          [B.RightLowerArm]: [0, 85 * DEG, 0],
        },
      },
      {
        t: 0.5,
        pose: {
          [B.LeftUpperArm]: [0, 0, -8 * DEG],
          [B.RightUpperArm]: [0, 0, 8 * DEG],
          [B.LeftLowerArm]: [0, -8 * DEG, 0],
          [B.RightLowerArm]: [0, 8 * DEG, 0],
        },
      },
      {
        t: 1,
        pose: {
          [B.LeftUpperArm]: [0, 0, 10 * DEG],
          [B.RightUpperArm]: [0, 0, -10 * DEG],
          [B.LeftLowerArm]: [0, -85 * DEG, 0],
          [B.RightLowerArm]: [0, 85 * DEG, 0],
        },
      },
    ],
  },
};

/** Relaxed standing pose used between sets and when an id has no motion. */
export const IDLE: Motion = {
  base: "standing",
  loopSec: 4,
  frames: [
    { t: 0, pose: { ...ARMS_DOWN }, hips: [0, 0, 0] },
    {
      t: 0.5,
      pose: {
        [B.LeftUpperArm]: [0, 0, 72 * DEG],
        [B.RightUpperArm]: [0, 0, -72 * DEG],
        [B.Chest]: [1.5 * DEG, 0, 0],
      },
      hips: [0, 0.012, 0],
    },
    { t: 1, pose: { ...ARMS_DOWN }, hips: [0, 0, 0] },
  ],
};

export function motionFor(exerciseId: string): Motion {
  return MOTIONS[exerciseId] ?? IDLE;
}

export type SampledPose = {
  bones: Map<VRMHumanBoneName_, Euler3>;
  hips: Euler3;
};

/**
 * Interpolates the motion at `phase` (0..1).
 *
 * Eased with a sine so reps accelerate out of the top and decelerate into
 * the bottom, the way a controlled rep actually moves. Linear phase reads
 * as robotic and, worse, teaches the wrong tempo.
 */
export function sampleMotion(motion: Motion, phase: number): SampledPose {
  const t = phase - Math.floor(phase);
  const frames = motion.frames;

  let index = 0;
  while (index < frames.length - 2 && frames[index + 1]!.t <= t) index++;

  const a = frames[index]!;
  const b = frames[Math.min(index + 1, frames.length - 1)]!;
  const span = Math.max(1e-6, b.t - a.t);
  const local = Math.min(1, Math.max(0, (t - a.t) / span));
  const eased = 0.5 - Math.cos(local * Math.PI) / 2;

  const bones = new Map<VRMHumanBoneName_, Euler3>();
  const names = new Set([
    ...Object.keys(a.pose),
    ...Object.keys(b.pose),
  ]) as Set<VRMHumanBoneName_>;

  for (const name of names) {
    const from = a.pose[name] ?? [0, 0, 0];
    const to = b.pose[name] ?? [0, 0, 0];
    bones.set(name, [
      from[0] + (to[0] - from[0]) * eased,
      from[1] + (to[1] - from[1]) * eased,
      from[2] + (to[2] - from[2]) * eased,
    ]);
  }

  const hipsFrom = a.hips ?? [0, 0, 0];
  const hipsTo = b.hips ?? [0, 0, 0];

  return {
    bones,
    hips: [
      hipsFrom[0] + (hipsTo[0] - hipsFrom[0]) * eased,
      hipsFrom[1] + (hipsTo[1] - hipsFrom[1]) * eased,
      hipsFrom[2] + (hipsTo[2] - hipsFrom[2]) * eased,
    ],
  };
}
