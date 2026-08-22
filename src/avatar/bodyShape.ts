// Applying a body shape to a VRM humanoid.
//
// VRM has no standard girth blendshapes, so the only lever every model
// exposes is the humanoid skeleton. Scaling a bone normally ruins the
// figure: the scale propagates to children, so a wider chest also gives
// the character longer arms.
//
// Two rules keep it honest:
//   1. Scale on X and Z only. Girth changes, limb length and stature do
//      not — which is what we want, since height is a known number and
//      must not drift when the shape estimate does.
//   2. Counter-scale the immediate children by the inverse. The bone's own
//      mesh thickens; everything hanging off it keeps its proportions.
//
// The result is not anatomically exact and is not claimed to be. It is a
// faithful *relative* read: the avatar at 78kg and the avatar at 68kg
// differ in the places the user's own photo says they carry weight, which
// is what makes the goal state worth looking at.

import { VRMHumanBoneName } from "@pixiv/three-vrm";
import type { Object3D } from "three";

type Axis = "x" | "y" | "z";
import type { BodyShape } from "../../shared/schema";
import type { Rig } from "./rig";

/** Maximum girth change at shape = ±1. Past ~30% the mesh visibly tears
 *  at the joints on most VRM models. */
const MAX_GIRTH = 0.28;

const NEUTRAL: BodyShape = {
  shoulder: 0,
  chest: 0,
  waist: 0,
  hip: 0,
  thigh: 0,
  arm: 0,
};

type BoneRule = {
  bone: VRMHumanBoneName;
  /** Which shape field drives this bone. */
  key: keyof BodyShape;
  /** Per-bone sensitivity — the waist reads a change far more than the
   *  upper chest does, so they must not move by the same amount. */
  gain: number;
  /** The humanoid bone that continues the chain. Its rest offset is what
   *  tells us which way this bone runs, and therefore which two axes carry
   *  girth. Named explicitly rather than inferred from Object3D.children,
   *  because a dressed model hangs skirt, hair and other spring bones off
   *  the hips — enough of them to out-vote the spine and leave the code
   *  convinced the hips run sideways. First one that resolves wins; not
   *  every model has an UpperChest. */
  next: VRMHumanBoneName[];
};

const RULES: BoneRule[] = [
  {
    bone: VRMHumanBoneName.Spine,
    key: "waist",
    gain: 1,
    next: [VRMHumanBoneName.Chest, VRMHumanBoneName.UpperChest, VRMHumanBoneName.Neck],
  },
  {
    bone: VRMHumanBoneName.Chest,
    key: "chest",
    gain: 0.75,
    next: [VRMHumanBoneName.UpperChest, VRMHumanBoneName.Neck],
  },
  { bone: VRMHumanBoneName.UpperChest, key: "chest", gain: 0.5, next: [VRMHumanBoneName.Neck] },
  { bone: VRMHumanBoneName.Hips, key: "hip", gain: 0.8, next: [VRMHumanBoneName.Spine] },
  {
    bone: VRMHumanBoneName.LeftUpperLeg,
    key: "thigh",
    gain: 0.9,
    next: [VRMHumanBoneName.LeftLowerLeg],
  },
  {
    bone: VRMHumanBoneName.RightUpperLeg,
    key: "thigh",
    gain: 0.9,
    next: [VRMHumanBoneName.RightLowerLeg],
  },
  {
    bone: VRMHumanBoneName.LeftUpperArm,
    key: "arm",
    gain: 0.7,
    next: [VRMHumanBoneName.LeftLowerArm],
  },
  {
    bone: VRMHumanBoneName.RightUpperArm,
    key: "arm",
    gain: 0.7,
    next: [VRMHumanBoneName.RightLowerArm],
  },
  {
    bone: VRMHumanBoneName.LeftShoulder,
    key: "shoulder",
    gain: 0.5,
    next: [VRMHumanBoneName.LeftUpperArm],
  },
  {
    bone: VRMHumanBoneName.RightShoulder,
    key: "shoulder",
    gain: 0.5,
    next: [VRMHumanBoneName.RightUpperArm],
  },
];

const clamp = (value: number, lo = -1, hi = 1) =>
  Math.min(hi, Math.max(lo, value));

/**
 * The two axes across a bone, i.e. the ones that carry girth.
 *
 * Which axis runs *along* a bone is not fixed: spine bones point up their
 * local Y, but a T-posed arm points down its local X, and raw VRM skeletons
 * vary. Scaling a fixed pair would lengthen the arms whenever the shape
 * said "thicker" — and scaling the hips along Y made the figure lose
 * height as it lost weight, which is how this was found.
 *
 * The direction comes from the next humanoid bone's rest offset. Rest, not
 * current: posing writes rotations, so the offset stays put and the axes do
 * not swing around mid-exercise.
 */
function girthAxes(rig: Rig, rule: BoneRule): [Axis, Axis] {
  for (const name of rule.next) {
    const next = rig.getScaleBone(name);
    if (!next) continue;

    const spread: [Axis, number][] = [
      ["x", Math.abs(next.position.x)],
      ["y", Math.abs(next.position.y)],
      ["z", Math.abs(next.position.z)],
    ];
    spread.sort((a, b) => b[1] - a[1]);
    const [[along, first], [, second]] = spread;

    // A direction is only worth believing when one axis clearly wins.
    // Alicia is the case in point: her hips sit 1.3cm below the spine and
    // 1.3cm in front of it, so the "longest" axis was decided by rounding
    // noise — and picking Z there scaled the pelvis vertically, which read
    // as the avatar shrinking as it lost weight. A pelvis is a hub, not a
    // shaft; when the reading is a coin toss, take the upright assumption.
    if (first < 1e-6 || first < second * 2) continue;

    if (along === "x") return ["y", "z"];
    if (along === "z") return ["x", "y"];
    return ["x", "z"];
  }
  // Nothing worth reading: a body bone standing upright is the safe answer.
  return ["x", "z"];
}

function setGirth(node: Object3D, axes: [Axis, Axis], value: number): void {
  node.scale.set(1, 1, 1);
  node.scale[axes[0]] = value;
  node.scale[axes[1]] = value;
}

/** Every humanoid bone the rig knows, so accessory bones can be told apart. */
function humanoidNodes(rig: Rig): Set<Object3D> {
  const nodes = new Set<Object3D>();
  for (const name of Object.values(VRMHumanBoneName)) {
    const node = rig.getScaleBone(name);
    if (node) nodes.add(node);
  }
  return nodes;
}

export function applyBodyShape(rig: Rig, shape: Partial<BodyShape>): void {
  const full = { ...NEUTRAL, ...shape };
  const humanoid = humanoidNodes(rig);

  const shaped = new Map<Object3D, number>();
  const targets: { node: Object3D; girth: number; axes: [Axis, Axis] }[] = [];
  for (const rule of RULES) {
    const node = rig.getScaleBone(rule.bone);
    if (!node) continue;
    const girth = 1 + clamp(full[rule.key]) * MAX_GIRTH * rule.gain;
    shaped.set(node, girth);
    targets.push({ node, girth, axes: girthAxes(rig, rule) });
  }

  /** The girth this bone already inherits from the nearest shaped ancestor. */
  const inherited = (node: Object3D): number => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      const g = shaped.get(parent);
      if (g !== undefined) return g;
    }
    return 1;
  };

  for (const { node, girth, axes } of targets) {
    // Scale is inherited down the skeleton, so writing the target girth
    // directly would compound it: a wider waist would also widen the chest,
    // which is then widened again by its own rule. Divide it out and every
    // bone lands on the girth its own rule asked for.
    setGirth(node, axes, girth / inherited(node));

    for (const child of node.children as Object3D[]) {
      // A bone with its own rule computes its own correction above.
      if (shaped.has(child)) continue;
      // Only the skeleton is corrected. A skirt or a strand of hair hanging
      // off the hips *should* follow them — and the mannequin's own capsule
      // is the flesh being shaped, so it must inherit too. Undoing the
      // girth on those is what made the bone itself stay put while
      // everything around it moved.
      if (!humanoid.has(child)) continue;
      // The rest — a neck, a forearm, a shin — keeps its own size: a
      // thicker chest must not hand the head a thicker skull.
      setGirth(child, axes, 1 / girth);
    }
  }
}

/** Returns every bone to its rig-authored scale. */
export function resetBodyShape(rig: Rig): void {
  for (const rule of RULES) {
    const node = rig.getScaleBone(rule.bone);
    if (!node) continue;
    node.scale.set(1, 1, 1);
    for (const child of node.children as Object3D[]) {
      child.scale.set(1, 1, 1);
    }
  }
}

/**
 * Estimates the shape at a different bodyweight.
 *
 * Fat is not lost evenly. The distribution below follows the general
 * pattern of where mass comes off first — abdomen fastest, limbs slowest —
 * scaled by how much of the current bodyweight is being lost. It is an
 * illustration of the direction of change, not a prediction, and the UI
 * labels it that way.
 */
export function projectShape(
  shape: BodyShape,
  currentKg: number,
  futureKg: number,
): BodyShape {
  // Fraction of bodyweight lost. 10% is a big, visible change; that maps
  // to roughly a full step of the shape scale at the waist.
  const lost = (currentKg - futureKg) / Math.max(1, currentKg);
  const pull = clamp(lost * 10, -1.5, 1.5);

  const shift = (value: number, sensitivity: number) =>
    clamp(value - pull * sensitivity);

  return {
    waist: shift(shape.waist, 1.0),
    hip: shift(shape.hip, 0.7),
    chest: shift(shape.chest, 0.5),
    thigh: shift(shape.thigh, 0.55),
    arm: shift(shape.arm, 0.4),
    // Shoulder width is frame, not fat. It does not move with weight.
    shoulder: shape.shoulder,
  };
}

/** Linear interpolation between two shapes, for the before/after slider. */
export function lerpShape(a: BodyShape, b: BodyShape, t: number): BodyShape {
  const mix = (x: number, y: number) => x + (y - x) * t;
  return {
    shoulder: mix(a.shoulder, b.shoulder),
    chest: mix(a.chest, b.chest),
    waist: mix(a.waist, b.waist),
    hip: mix(a.hip, b.hip),
    thigh: mix(a.thigh, b.thigh),
    arm: mix(a.arm, b.arm),
  };
}

/**
 * Falls back to a shape derived from BMI alone when no photo has been
 * analysed yet, so the avatar is never a generic mannequin.
 */
export function shapeFromBmi(bmiValue: number): BodyShape {
  // BMI 22 is the reference; each point above or below moves the trunk.
  const delta = clamp((bmiValue - 22) / 8);
  return {
    shoulder: 0,
    chest: delta * 0.5,
    waist: delta,
    hip: delta * 0.7,
    thigh: delta * 0.6,
    arm: delta * 0.4,
  };
}
