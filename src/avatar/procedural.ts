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
  /** Whole-body orientation the exercise happens in.
   *
   *  Poses are always authored standing — it is the only frame anyone can
   *  reason about — and the figure is then tipped into place. "side" rolls
   *  it onto one flank, which a plank held sideways needs and which
   *  tipping forward or back cannot produce. */
  base: "standing" | "prone" | "supine" | "side";
  /** One repetition in seconds. */
  loopSec: number;
  /**
   * Metres to lift the figure off the floor, for anything not standing.
   *
   * Tipping a standing figure lays it along the ground; what holds it up
   * after that is whichever limb is bearing weight, and that differs by
   * exercise. Straight arms hold a push-up roughly twice as high as folded
   * forearms hold a plank. One shared constant put the arms through the
   * floor for half of them.
   */
  floorHeight?: number;
  frames: Keyframe[];
};

const DEG = Math.PI / 180;

/**
 * Arms holding the body off the floor.
 *
 * Authored standing, so "straight out in front" is what becomes "straight
 * down at the floor" once the figure is tipped face-down. The previous
 * version left the arms hanging at the sides, which after tipping put them
 * along the ribs — the figure then read as lying flat rather than
 * supporting itself, which is exactly how it looked.
 */
const SUPPORT_ARMS: BonePose = {
  [B.LeftUpperArm]: [92 * DEG, 0, 76 * DEG],
  [B.RightUpperArm]: [92 * DEG, 0, -76 * DEG],
  [B.LeftLowerArm]: [0, 0, 0],
  [B.RightLowerArm]: [0, 0, 0],
};

/** The same, folded to the elbows — a forearm plank. */
const FOREARM_SUPPORT: BonePose = {
  [B.LeftUpperArm]: [92 * DEG, 0, 76 * DEG],
  [B.RightUpperArm]: [92 * DEG, 0, -76 * DEG],
  [B.LeftLowerArm]: [0, -85 * DEG, 0],
  [B.RightLowerArm]: [0, 85 * DEG, 0],
};

/** Feet pointed so the toes, not the shins, meet the floor. */
const ON_TOES: BonePose = {
  [B.LeftFoot]: [-42 * DEG, 0, 0],
  [B.RightFoot]: [-42 * DEG, 0, 0],
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
    floorHeight: 0.46,
    frames: [
      {
        t: 0,
        pose: { ...SUPPORT_ARMS, ...ON_TOES, [B.Spine]: [0, 0, 0] },
        hips: [0, 0, 0],
      },
      {
        t: 0.45,
        pose: {
          ...ON_TOES,
          // Elbows fold and travel back along the ribs; the chest, not the
          // hips, is what comes down.
          [B.LeftUpperArm]: [78 * DEG, 0, 62 * DEG],
          [B.RightUpperArm]: [78 * DEG, 0, -62 * DEG],
          [B.LeftLowerArm]: [0, -72 * DEG, 0],
          [B.RightLowerArm]: [0, 72 * DEG, 0],
        },
        hips: [0, -0.14, 0],
      },
      {
        t: 1,
        pose: { ...SUPPORT_ARMS, ...ON_TOES },
        hips: [0, 0, 0],
      },
    ],
  },

  "knee-pushup": {
    base: "prone",
    loopSec: 2.8,
    floorHeight: 0.42,
    frames: [
      {
        t: 0,
        pose: {
          ...SUPPORT_ARMS,
          // Knees down: the lower legs fold up behind, and the ankles go
          // with them so the feet are not left standing on air.
          [B.LeftLowerLeg]: [-88 * DEG, 0, 0],
          [B.RightLowerLeg]: [-88 * DEG, 0, 0],
        },
        hips: [0, -0.02, 0],
      },
      {
        t: 0.45,
        pose: {
          [B.LeftUpperArm]: [78 * DEG, 0, 62 * DEG],
          [B.RightUpperArm]: [78 * DEG, 0, -62 * DEG],
          [B.LeftLowerArm]: [0, -70 * DEG, 0],
          [B.RightLowerArm]: [0, 70 * DEG, 0],
          [B.LeftLowerLeg]: [-88 * DEG, 0, 0],
          [B.RightLowerLeg]: [-88 * DEG, 0, 0],
        },
        hips: [0, -0.13, 0],
      },
      {
        t: 1,
        pose: {
          ...SUPPORT_ARMS,
          [B.LeftLowerLeg]: [-88 * DEG, 0, 0],
          [B.RightLowerLeg]: [-88 * DEG, 0, 0],
        },
        hips: [0, -0.02, 0],
      },
    ],
  },

  plank: {
    base: "prone",
    loopSec: 4,
    floorHeight: 0.26,
    frames: [
      // A hold should look held: the only movement is breathing.
      { t: 0, pose: { ...FOREARM_SUPPORT, ...ON_TOES }, hips: [0, -0.02, 0] },
      {
        t: 0.5,
        pose: { ...FOREARM_SUPPORT, ...ON_TOES, [B.Chest]: [2.5 * DEG, 0, 0] },
        hips: [0, -0.005, 0],
      },
      { t: 1, pose: { ...FOREARM_SUPPORT, ...ON_TOES }, hips: [0, -0.02, 0] },
    ],
  },

  "side-plank": {
    base: "side",
    loopSec: 4,
    floorHeight: 0.3,
    frames: [
      {
        t: 0,
        pose: {
          // One forearm down, the other arm reaching for the ceiling.
          [B.LeftUpperArm]: [92 * DEG, 0, 74 * DEG],
          [B.LeftLowerArm]: [0, -80 * DEG, 0],
          [B.RightUpperArm]: [0, 0, -12 * DEG],
          [B.LeftFoot]: [-30 * DEG, 0, 0],
          [B.RightFoot]: [-30 * DEG, 0, 0],
        },
        hips: [0, -0.02, 0],
      },
      {
        t: 0.5,
        pose: {
          [B.LeftUpperArm]: [92 * DEG, 0, 74 * DEG],
          [B.LeftLowerArm]: [0, -80 * DEG, 0],
          [B.RightUpperArm]: [0, 0, -12 * DEG],
          [B.Spine]: [0, 0, 3 * DEG],
          [B.LeftFoot]: [-30 * DEG, 0, 0],
          [B.RightFoot]: [-30 * DEG, 0, 0],
        },
        hips: [0, 0.01, 0],
      },
      {
        t: 1,
        pose: {
          [B.LeftUpperArm]: [92 * DEG, 0, 74 * DEG],
          [B.LeftLowerArm]: [0, -80 * DEG, 0],
          [B.RightUpperArm]: [0, 0, -12 * DEG],
          [B.LeftFoot]: [-30 * DEG, 0, 0],
          [B.RightFoot]: [-30 * DEG, 0, 0],
        },
        hips: [0, -0.02, 0],
      },
    ],
  },

  "mountain-climber": {
    base: "prone",
    loopSec: 1.4,
    floorHeight: 0.46,
    frames: [
      {
        t: 0,
        pose: {
          ...SUPPORT_ARMS,
          ...ON_TOES,
          [B.LeftUpperLeg]: [72 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-80 * DEG, 0, 0],
        },
        hips: [0, 0, 0],
      },
      {
        t: 0.5,
        pose: {
          ...SUPPORT_ARMS,
          ...ON_TOES,
          [B.RightUpperLeg]: [72 * DEG, 0, 0],
          [B.RightLowerLeg]: [-80 * DEG, 0, 0],
        },
        hips: [0, 0, 0],
      },
      {
        t: 1,
        pose: {
          ...SUPPORT_ARMS,
          ...ON_TOES,
          [B.LeftUpperLeg]: [72 * DEG, 0, 0],
          [B.LeftLowerLeg]: [-80 * DEG, 0, 0],
        },
        hips: [0, 0, 0],
      },
    ],
  },

  crunch: {
    base: "supine",
    loopSec: 2.4,
    floorHeight: 0.16,
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
    floorHeight: 0.16,
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
    floorHeight: 0.16,
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
    floorHeight: 0.22,
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
    floorHeight: 0.12,
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
