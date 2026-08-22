import { describe, expect, it } from "vitest";
import { Box3, Quaternion, Vector3 } from "three";
import { VRMHumanBoneName } from "@pixiv/three-vrm";
import { applyBodyShape, lerpShape, projectShape, shapeFromBmi } from "./bodyShape";
import { createMannequin } from "./mannequin";
import type { Rig } from "./rig";
import { IDLE, MOTIONS, motionFor, sampleMotion } from "./procedural";
import { EXERCISES } from "../../shared/exercises";
import type { BodyShape } from "../../shared/schema";

const shape: BodyShape = {
  shoulder: 0.3,
  chest: 0.4,
  waist: 0.8,
  hip: 0.5,
  thigh: 0.4,
  arm: 0.2,
};

describe("projectShape", () => {
  it("slims the trunk when weight comes off", () => {
    const lighter = projectShape(shape, 80, 70);
    expect(lighter.waist).toBeLessThan(shape.waist);
    expect(lighter.hip).toBeLessThan(shape.hip);
  });

  it("takes more off the waist than the arms", () => {
    const lighter = projectShape(shape, 80, 70);
    expect(shape.waist - lighter.waist).toBeGreaterThan(
      shape.arm - lighter.arm,
    );
  });

  it("leaves shoulder width alone — frame is not fat", () => {
    expect(projectShape(shape, 80, 70).shoulder).toBe(shape.shoulder);
  });

  it("thickens the trunk when weight is gained", () => {
    const heavier = projectShape({ ...shape, waist: 0 }, 70, 80);
    expect(heavier.waist).toBeGreaterThan(0);
  });

  it("stays inside the -1..1 range the bone scaling accepts", () => {
    const extreme = projectShape({ ...shape, waist: 1 }, 120, 60);
    for (const value of Object.values(extreme)) {
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("is a no-op when the weights match", () => {
    expect(projectShape(shape, 75, 75)).toEqual(shape);
  });
});

describe("lerpShape", () => {
  it("returns the endpoints at t=0 and t=1", () => {
    const other = projectShape(shape, 80, 70);
    expect(lerpShape(shape, other, 0)).toEqual(shape);
    expect(lerpShape(shape, other, 1)).toEqual(other);
  });

  it("lands halfway at t=0.5", () => {
    const a: BodyShape = { ...shape, waist: 0 };
    const b: BodyShape = { ...shape, waist: 1 };
    expect(lerpShape(a, b, 0.5).waist).toBeCloseTo(0.5, 6);
  });
});

describe("shapeFromBmi", () => {
  it("is neutral at the reference BMI", () => {
    expect(shapeFromBmi(22).waist).toBeCloseTo(0, 6);
  });

  it("moves the waist most and never leaves the valid range", () => {
    const heavy = shapeFromBmi(35);
    expect(heavy.waist).toBeGreaterThan(heavy.arm);
    expect(heavy.waist).toBeLessThanOrEqual(1);
    expect(shapeFromBmi(14).waist).toBeGreaterThanOrEqual(-1);
  });
});

describe("sampleMotion", () => {
  it("returns the first frame at phase 0", () => {
    const sample = sampleMotion(MOTIONS.squat!, 0);
    expect(sample.hips[1]).toBeCloseTo(0, 6);
  });

  it("reaches the bottom of a squat mid-rep", () => {
    const bottom = sampleMotion(MOTIONS.squat!, 0.45);
    expect(bottom.hips[1]).toBeLessThan(-0.3);
  });

  it("loops — phase 1.25 equals phase 0.25", () => {
    const a = sampleMotion(MOTIONS.squat!, 0.25);
    const b = sampleMotion(MOTIONS.squat!, 1.25);
    expect(b.hips).toEqual(a.hips);
  });

  it("handles a phase beyond several loops", () => {
    const sample = sampleMotion(MOTIONS.squat!, 7.45);
    expect(sample.hips[1]).toBeLessThan(-0.3);
  });

  it("interpolates bones that only one adjacent frame declares", () => {
    // Knees are absent from the standing frames and present at the bottom,
    // so mid-descent they must be partially bent, not snapped.
    const mid = sampleMotion(MOTIONS.squat!, 0.22);
    const knee = mid.bones.get("leftLowerLeg");
    expect(knee).toBeDefined();
    expect(knee![0]).toBeLessThan(0);
    expect(knee![0]).toBeGreaterThan(-95 * (Math.PI / 180));
  });
});

describe("motionFor", () => {
  it("falls back to idle for an unknown exercise", () => {
    expect(motionFor("no-such-exercise")).toBe(IDLE);
  });

  it("covers every exercise in the catalogue or falls back cleanly", () => {
    for (const exercise of EXERCISES) {
      const motion = motionFor(exercise.id);
      expect(motion.frames.length).toBeGreaterThanOrEqual(2);
      expect(motion.loopSec).toBeGreaterThan(0);
    }
  });

  it("keyframes are ordered and span the full loop", () => {
    for (const motion of Object.values(MOTIONS)) {
      expect(motion.frames[0]!.t).toBe(0);
      expect(motion.frames.at(-1)!.t).toBe(1);
      for (let i = 1; i < motion.frames.length; i++) {
        expect(motion.frames[i]!.t).toBeGreaterThan(motion.frames[i - 1]!.t);
      }
    }
  });
});

// These two are regressions, both found by looking at the figure rather
// than at the code: at the goal weight the mannequin was losing height and
// growing hips. Scale is inherited down a skeleton, which makes both
// failure modes easy to reintroduce and invisible in a diff.
describe("applyBodyShape on the mannequin", () => {
  const heavy: BodyShape = {
    shoulder: 0,
    chest: 0.6,
    waist: 1,
    hip: 1,
    thigh: 0.8,
    arm: 0.3,
  };

  const worldGirth = (rig: Rig, bone: VRMHumanBoneName) => {
    rig.root.updateMatrixWorld(true);
    const scale = new Vector3();
    rig
      .getScaleBone(bone)!
      .matrixWorld.decompose(new Vector3(), new Quaternion(), scale);
    return scale.x;
  };

  const boxOf = (rig: Rig) => {
    rig.root.updateMatrixWorld(true);
    return new Box3().setFromObject(rig.root);
  };

  it("never scales a bone along its own length", () => {
    const rig = createMannequin();
    applyBodyShape(rig, heavy);

    // Hips run up the Y axis; scaling that is what shortened the figure.
    const hips = rig.getScaleBone(VRMHumanBoneName.Hips)!;
    expect(hips.scale.y).toBeCloseTo(1, 6);

    // A T-posed arm runs along X, so girth is Y and Z there.
    const arm = rig.getScaleBone(VRMHumanBoneName.LeftUpperArm)!;
    expect(arm.scale.x).toBeCloseTo(1, 6);

    rig.dispose();
  });

  it("keeps the figure the same height whatever the shape", () => {
    const thin = createMannequin();
    applyBodyShape(thin, { ...heavy, waist: -1, hip: -1, thigh: -1 });
    const thinBox = boxOf(thin);

    const fat = createMannequin();
    applyBodyShape(fat, heavy);
    const fatBox = boxOf(fat);

    expect(fatBox.max.y - fatBox.min.y).toBeCloseTo(
      thinBox.max.y - thinBox.min.y,
      3,
    );

    // ...and wider round the middle where the shape said so. Measured on
    // the spine rather than the bounding box: the figure rests in a T
    // pose, so its overall width is the arm span and says nothing about
    // the waist.
    expect(worldGirth(fat, VRMHumanBoneName.Spine)).toBeGreaterThan(
      worldGirth(thin, VRMHumanBoneName.Spine),
    );

    thin.dispose();
    fat.dispose();
  });

  it("does not hand the head the chest's girth", () => {
    const rig = createMannequin();
    applyBodyShape(rig, heavy);
    rig.root.updateMatrixWorld(true);

    const head = rig.getScaleBone(VRMHumanBoneName.Head)!;
    const scale = new Vector3();
    head.matrixWorld.decompose(new Vector3(), new Quaternion(), scale);
    expect(scale.x).toBeCloseTo(1, 3);
    expect(scale.z).toBeCloseTo(1, 3);

    rig.dispose();
  });
});
