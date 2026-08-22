// A primitive stand-in figure with a VRM-compatible bone hierarchy.
//
// VRM avatars cannot be bundled — the good ones are licensed per model and
// none of them are ours to redistribute. Without a fallback, every user
// would meet an empty 3D panel until they went and sourced a .vrm, which
// would make the body and training screens useless out of the box.
//
// So this builds a jointed mannequin from capsules, named with the same
// `VRMHumanBoneName` keys and posed in the same T-rest. Everything
// downstream — the girth scaling in bodyShape.ts, the exercise keyframes
// in procedural.ts — drives it unchanged. Drop a .vrm in and the same code
// drives that instead, at much better fidelity.

import * as THREE from "three";
import { VRMHumanBoneName as B } from "@pixiv/three-vrm";
import type { Rig } from "./rig";

/** Proportions for a 1.70m figure, in metres from the floor. */
const SEG = {
  hipsY: 0.94,
  spine: 0.1,
  chest: 0.11,
  upperChest: 0.09,
  neck: 0.09,
  head: 0.09,
  shoulderX: 0.05,
  upperArm: 0.13,
  lowerArm: 0.26,
  hand: 0.24,
  legX: 0.085,
  upperLeg: 0.44,
  lowerLeg: 0.42,
};

type Limb = { radius: number; length: number; axis: "x" | "y" };

export function createMannequin(): Rig {
  const root = new THREE.Object3D();
  // Built in VRM 0.x space — forward is -Z, which puts the figure's left
  // on -X — because that is the space procedural.ts was authored in. The
  // half turn is the same one VRMUtils.rotateVRM0 applies to a real 0.x
  // model, and it is what turns the figure to face the camera. Only
  // rotation.x is touched per frame, so this survives.
  root.rotation.y = Math.PI;
  const bones = new Map<string, THREE.Object3D>();
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];

  const skin = new THREE.MeshStandardMaterial({
    color: 0xb9c2cc,
    roughness: 0.72,
    metalness: 0.04,
  });
  materials.push(skin);

  /** Creates a bone node, optionally with a capsule hanging off it. */
  const bone = (
    name: string,
    parent: THREE.Object3D,
    offset: [number, number, number],
    limb?: Limb,
  ): THREE.Object3D => {
    const node = new THREE.Object3D();
    node.name = name;
    node.position.set(...offset);
    parent.add(node);
    bones.set(name, node);

    if (limb) {
      const geometry = new THREE.CapsuleGeometry(
        limb.radius,
        Math.max(0.01, limb.length - limb.radius * 2),
        4,
        12,
      );
      geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, skin);
      // The capsule is built along +Y centred on the origin; shift it to
      // start at the joint and rotate when the limb runs along X.
      if (limb.axis === "y") {
        mesh.position.y = -limb.length / 2;
      } else {
        mesh.rotation.z = Math.PI / 2;
        mesh.position.x = limb.length / 2;
      }
      mesh.castShadow = true;
      node.add(mesh);
    }
    return node;
  };

  const hips = bone("hips-root", root, [0, SEG.hipsY, 0]);
  bones.set(B.Hips, hips);
  const pelvis = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.115, 0.06, 4, 12),
    skin,
  );
  pelvis.rotation.z = Math.PI / 2;
  hips.add(pelvis);

  const spine = bone(B.Spine, hips, [0, 0, 0], {
    radius: 0.105,
    length: SEG.spine,
    axis: "y",
  });
  // Capsules hang downward by default; the torso segments grow upward, so
  // re-seat each trunk mesh above its joint.
  reseatUp(spine, SEG.spine);

  const chest = bone(B.Chest, spine, [0, SEG.spine, 0], {
    radius: 0.115,
    length: SEG.chest,
    axis: "y",
  });
  reseatUp(chest, SEG.chest);

  const upperChest = bone(B.UpperChest, chest, [0, SEG.chest, 0], {
    radius: 0.118,
    length: SEG.upperChest,
    axis: "y",
  });
  reseatUp(upperChest, SEG.upperChest);

  const neck = bone(B.Neck, upperChest, [0, SEG.upperChest, 0], {
    radius: 0.042,
    length: SEG.neck,
    axis: "y",
  });
  reseatUp(neck, SEG.neck);

  const head = bone(B.Head, neck, [0, SEG.neck, 0]);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.095, 20, 16), skin);
  skull.position.y = 0.085;
  head.add(skull);

  for (const side of [1, -1] as const) {
    // -X is the figure's left when forward is -Z.
    const isLeft = side < 0;
    // Limb capsules are authored running along +X, so anything placed on
    // -X has to be flipped to sit on the correct side of its joint.
    const flip = side < 0;
    const shoulderName = isLeft ? B.LeftShoulder : B.RightShoulder;
    const upperArmName = isLeft ? B.LeftUpperArm : B.RightUpperArm;
    const lowerArmName = isLeft ? B.LeftLowerArm : B.RightLowerArm;
    const handName = isLeft ? B.LeftHand : B.RightHand;

    const shoulder = bone(
      shoulderName,
      upperChest,
      [side * SEG.shoulderX, SEG.upperChest * 0.8, 0],
      { radius: 0.05, length: SEG.upperArm * 0.6, axis: "x" },
    );
    if (flip) mirrorX(shoulder);

    const upperArm = bone(
      upperArmName,
      shoulder,
      [side * SEG.upperArm * 0.6, 0, 0],
      { radius: 0.046, length: SEG.upperArm, axis: "x" },
    );
    if (flip) mirrorX(upperArm);

    const lowerArm = bone(
      lowerArmName,
      upperArm,
      [side * SEG.upperArm, 0, 0],
      { radius: 0.038, length: SEG.lowerArm, axis: "x" },
    );
    if (flip) mirrorX(lowerArm);

    const hand = bone(handName, lowerArm, [side * SEG.lowerArm, 0, 0], {
      radius: 0.033,
      length: SEG.hand * 0.4,
      axis: "x",
    });
    if (flip) mirrorX(hand);

    const upperLegName = isLeft ? B.LeftUpperLeg : B.RightUpperLeg;
    const lowerLegName = isLeft ? B.LeftLowerLeg : B.RightLowerLeg;
    const footName = isLeft ? B.LeftFoot : B.RightFoot;

    const upperLeg = bone(upperLegName, hips, [side * SEG.legX, 0, 0], {
      radius: 0.068,
      length: SEG.upperLeg,
      axis: "y",
    });
    const lowerLeg = bone(lowerLegName, upperLeg, [0, -SEG.upperLeg, 0], {
      radius: 0.055,
      length: SEG.lowerLeg,
      axis: "y",
    });
    const foot = bone(footName, lowerLeg, [0, -SEG.lowerLeg, 0]);
    const shoe = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.05, 0.2),
      skin,
    );
    shoe.position.set(0, -0.025, -0.05);
    foot.add(shoe);
  }

  // Collect geometries created inline above for disposal.
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) geometries.push(object.geometry);
  });

  return {
    root,
    getBone: (name) => bones.get(name) ?? null,
    // One skeleton, so posing and scaling address the same nodes.
    getScaleBone: (name) => bones.get(name) ?? null,
    update: () => {},
    dispose: () => {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

/** Trunk capsules grow up from the joint, not down. */
function reseatUp(node: THREE.Object3D, length: number): void {
  const mesh = node.children.find((child) => child instanceof THREE.Mesh);
  if (mesh) mesh.position.y = length / 2;
}

/** The right side is the left side mirrored; flipping the mesh keeps the
 *  capsule on the correct side of its joint without a second geometry. */
function mirrorX(node: THREE.Object3D): void {
  const mesh = node.children.find((child) => child instanceof THREE.Mesh);
  if (mesh) mesh.position.x *= -1;
}
