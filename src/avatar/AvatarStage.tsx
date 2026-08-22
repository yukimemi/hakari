// The 3D stage.
//
// Loads a VRM when one is available and falls back to the primitive
// mannequin otherwise, then drives whichever it got with the same body
// shape and the same exercise keyframes. The camera reframes per base
// pose, because a push-up viewed from the standing camera is a shape you
// cannot read.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  VRMHumanBoneName,
  VRMLoaderPlugin,
  VRMUtils,
  type VRM,
} from "@pixiv/three-vrm";
import { applyBodyShape } from "./bodyShape";
import { createMannequin } from "./mannequin";
import { motionFor, sampleMotion, IDLE, type Motion } from "./procedural";
import { rigFromVrm, type Rig } from "./rig";
import type { BodyShape } from "../../shared/schema";

type Props = {
  /** Path or URL to a .vrm. Falls back to the mannequin when it 404s. */
  src?: string;
  /** Show the bare mannequin even when a .vrm is available. Clothing is
   *  baked into a VRM's mesh, so a costume hides exactly the thing the
   *  body screen exists to show. */
  bare?: boolean;
  shape: BodyShape;
  /** Exercise id from the shared catalogue, or undefined to idle. */
  exerciseId?: string;
  /** Repetition tempo multiplier. 1 = the motion's authored speed. */
  speed?: number;
  paused?: boolean;
  className?: string;
};

export default function AvatarStage({
  src,
  bare = false,
  shape,
  exerciseId,
  speed = 1,
  paused = false,
  className = "",
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const shapeRef = useRef(shape);
  const motionRef = useRef<Motion>(IDLE);
  const speedRef = useRef(speed);
  const pausedRef = useRef(paused);
  const [usingFallback, setUsingFallback] = useState(false);
  const [ready, setReady] = useState(false);
  const [moved, setMoved] = useState(false);
  const resetViewRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    shapeRef.current = shape;
  }, [shape]);
  useEffect(() => {
    motionRef.current = exerciseId ? motionFor(exerciseId) : IDLE;
  }, [exerciseId]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(1.6, 2.6, 2.2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xc9d6e4, 0.9);
    rim.position.set(-2, 1.4, -1.6);
    scene.add(rim);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a939c, 0.85));

    // A graduated floor, matching the instrument language of the rest of
    // the app — it also gives the eye a ground plane to judge depth by.
    const grid = new THREE.GridHelper(6, 24, 0x9aa3ab, 0x9aa3ab);
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.opacity = 0.18;
    gridMaterial.transparent = true;
    scene.add(grid);

    // Dragging turns the figure. Without it the back of the body — the
    // half a photo never shows — is simply unreachable, and a demonstration
    // you cannot walk around is half a demonstration.
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 1.2;
    controls.maxDistance = 6;
    // Stop short of the poles: passing under the floor or over the head
    // flips the view and loses the ground plane the eye reads depth from.
    controls.minPolarAngle = 0.25;
    controls.maxPolarAngle = Math.PI / 2 + 0.15;
    controls.rotateSpeed = 0.7;

    // Once the view has been moved by hand, stop yanking it back on every
    // pose change — but offer the way home.
    let touched = false;
    const markTouched = () => {
      if (touched) return;
      touched = true;
      setMoved(true);
    };
    controls.addEventListener("start", markTouched);

    let framedFor: Motion["base"] | null = null;
    const frameFor = (base: Motion["base"]) => {
      framedFor = base;
      frameCamera(camera, controls, base);
    };
    resetViewRef.current = () => {
      touched = false;
      setMoved(false);
      frameFor(framedFor ?? "standing");
    };

    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    let rig: Rig | null = null;

    const install = (loaded: Rig) => {
      if (disposed) {
        loaded.dispose();
        return;
      }
      rig = loaded;
      scene.add(loaded.root);
      setReady(true);
    };

    const loadVrm = async (url: string) => {
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));
      const gltf = await loader.loadAsync(url);
      const vrm = gltf.userData.vrm as VRM | undefined;
      if (!vrm) throw new Error("VRM データを含んでいません");
      // VRM0 models face -Z; without this the avatar shows its back.
      VRMUtils.rotateVRM0(vrm);
      vrm.scene.traverse((object) => {
        object.frustumCulled = false;
      });
      return rigFromVrm(vrm);
    };

    (async () => {
      if (src && !bare) {
        try {
          install(await loadVrm(src));
          return;
        } catch {
          // A missing or malformed VRM is the common case, not an error
          // worth blocking on — fall through to the mannequin and let the
          // UI mention that a model can be added.
          if (!disposed) setUsingFallback(true);
        }
      } else if (!disposed && !bare) {
        setUsingFallback(true);
      }
      install(createMannequin());
    })();

    const clock = new THREE.Clock();
    let elapsed = 0;
    const euler = new THREE.Euler();

    renderer.setAnimationLoop(() => {
      const delta = clock.getDelta();
      if (!pausedRef.current) elapsed += delta * speedRef.current;

      if (rig) {
        const motion = motionRef.current;
        const sample = sampleMotion(motion, elapsed / motion.loopSec);

        for (const [boneName, angles] of sample.bones) {
          const node = rig.getBone(boneName);
          if (!node) continue;
          euler.set(angles[0], angles[1], angles[2]);
          node.quaternion.setFromEuler(euler);
        }

        const hips = rig.getBone(VRMHumanBoneName.Hips);
        if (hips) {
          hips.position.x = sample.hips[0];
          hips.position.z = sample.hips[2];
        }

        // Lying-down exercises are staged by tipping the whole figure and
        // dropping it to the floor, rather than authoring a second rig.
        //
        // Only the X axis: the Y rotation is what turns a figure authored
        // in VRM 0.x space around to face the camera (VRMUtils.rotateVRM0
        // for a real model, the same half turn for the mannequin), and
        // writing all three axes here used to wipe it out every frame.
        const base = motion.base;
        rig.root.rotation.x =
          base === "prone" ? Math.PI / 2 : base === "supine" ? -Math.PI / 2 : 0;
        if (base !== framedFor && !touched) frameFor(base);
        rig.root.position.y =
          base === "standing" ? sample.hips[1] : 0.24 + sample.hips[1];
        rig.root.position.z = base === "standing" ? 0 : -0.45;

        applyBodyShape(rig, shapeRef.current);
        rig.update(delta);
      }

      controls.update();
      renderer.render(scene, camera);
    });

    resize();

    return () => {
      disposed = true;
      resetViewRef.current = null;
      renderer.setAnimationLoop(null);
      controls.removeEventListener("start", markTouched);
      controls.dispose();
      observer.disconnect();
      rig?.dispose();
      grid.geometry.dispose();
      gridMaterial.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, [src, bare]);

  return (
    <div className={`relative ${className}`}>
      <div ref={hostRef} className="h-full w-full" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">
          読み込み中…
        </div>
      )}
      {ready && (
        <button
          type="button"
          onClick={() => resetViewRef.current?.()}
          className="absolute right-2 top-2 rounded-lg border border-rule/70 bg-panel/80 px-2 py-1 text-[10px] text-muted backdrop-blur transition-opacity hover:text-ink"
        >
          {moved ? "正面に戻す" : "ドラッグで回す"}
        </button>
      )}
      {ready && usingFallback && (
        <p className="absolute bottom-2 left-2 right-2 text-[10px] leading-snug text-muted">
          簡易モデルで表示しています。設定から .vrm を指定すると好きなアバターになります。
        </p>
      )}
    </div>
  );
}

/** Standing figures read best from the front; floor work needs a
 *  three-quarter view or the movement collapses into a line. */
function frameCamera(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  base: Motion["base"],
): void {
  if (base === "standing") {
    camera.position.set(0, 1.05, 3.1);
    controls.target.set(0, 0.95, 0);
  } else {
    camera.position.set(2.3, 1.15, 2.0);
    controls.target.set(0, 0.25, -0.3);
  }
  controls.update();
}
