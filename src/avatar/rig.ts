// One interface over "a real VRM" and "the fallback mannequin".
//
// Everything that poses or reshapes a figure talks to this, so the body
// screen and the training screen never branch on which one is loaded.

import type * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { VRMUtils } from "@pixiv/three-vrm";

export type Rig = {
  root: THREE.Object3D;
  getBone(name: string): THREE.Object3D | null;
  /** The node to write *scale* onto. Not the same as `getBone` for a real
   *  VRM: three-vrm copies position and rotation from the normalized
   *  humanoid down to the model's own bones, but not scale — so scaling a
   *  normalized bone changes nothing you can see. */
  getScaleBone(name: string): THREE.Object3D | null;
  /** Per-frame work the underlying representation needs (spring bones,
   *  look-at). The mannequin has none. */
  update(deltaSec: number): void;
  dispose(): void;
  /** Present only for real VRMs — the body-shape code counter-scales
   *  children, which needs the normalized humanoid. */
  vrm?: VRM;
};

export function rigFromVrm(vrm: VRM): Rig {
  return {
    root: vrm.scene,
    vrm,
    getBone: (name) => vrm.humanoid.getNormalizedBoneNode(name as never),
    getScaleBone: (name) => vrm.humanoid.getRawBoneNode(name as never),
    update: (delta) => vrm.update(delta),
    dispose: () => VRMUtils.deepDispose(vrm.scene),
  };
}
