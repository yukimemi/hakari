// Where the camera goes for each kind of pose. Plain numbers, so the rule
// that matters — a re-frame keeps the side the viewer walked round to — can
// be tested without a WebGL context.

import type { Motion } from "./procedural";

type Vec3 = [number, number, number];

export type Framing = { position: Vec3; target: Vec3 };

/** Standing figures read best from the front; floor work needs a
 *  three-quarter view or the movement collapses into a line. Floor work is
 *  centred on the origin (the hips sit there), so the camera looks at the
 *  origin's neighbourhood.
 *
 *  Standing: the camera's vertical field of view is 30°, so at 3.6 m it
 *  covers about 1.9 m, centred a little below the figure's middle. That keeps
 *  the feet in frame (the old 3.1 m / 0.95 m framing cut the shins off) with
 *  room above the head for a jump. */
const DEFAULT: Record<"standing" | "floor", Framing> = {
  standing: { position: [0, 1.0, 3.6], target: [0, 0.8, 0] },
  floor: { position: [1.7, 0.95, 1.7], target: [0, 0.3, 0] },
};

/**
 * Framing for a pose. With `azimuth` (radians around the vertical axis, as
 * OrbitControls reports it) the camera keeps that side of the figure and only
 * the distance, height and aim are re-framed. Without it the default front /
 * three-quarter view is used.
 */
export function framingFor(base: Motion["base"], azimuth?: number): Framing {
  const { position, target } = DEFAULT[base === "standing" ? "standing" : "floor"];
  if (azimuth === undefined) return { position: [...position], target: [...target] };
  const radius = Math.hypot(position[0] - target[0], position[2] - target[2]);
  return {
    position: [
      target[0] + radius * Math.sin(azimuth),
      position[1],
      target[2] + radius * Math.cos(azimuth),
    ],
    target: [...target],
  };
}
