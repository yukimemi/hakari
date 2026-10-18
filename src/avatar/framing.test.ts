import { describe, expect, it } from "vitest";
import { framingFor } from "./framing";

const azimuthOf = ({ position, target }: ReturnType<typeof framingFor>) =>
  Math.atan2(position[0] - target[0], position[2] - target[2]);
const radiusOf = ({ position, target }: ReturnType<typeof framingFor>) =>
  Math.hypot(position[0] - target[0], position[2] - target[2]);

describe("framingFor", () => {
  it("looks at the figure's height, not the standing view's, for floor work", () => {
    const standing = framingFor("standing");
    const floor = framingFor("prone");
    expect(floor.target[1]).toBeLessThan(standing.target[1]);
    expect(floor.position[1]).toBeLessThan(standing.position[1]);
  });

  it("keeps the side the viewer walked round to when the pose changes", () => {
    const walkedBehind = framingFor("supine", Math.PI * 0.9);
    expect(azimuthOf(walkedBehind)).toBeCloseTo(Math.PI * 0.9, 6);
    // Distance and aim still follow the new pose.
    expect(radiusOf(walkedBehind)).toBeCloseTo(radiusOf(framingFor("supine")), 6);
    expect(walkedBehind.target).toEqual(framingFor("supine").target);
  });

  it("reproduces the default view when given the default's own azimuth", () => {
    const base = framingFor("side");
    const again = framingFor("side", azimuthOf(base));
    again.position.forEach((v, i) => expect(v).toBeCloseTo(base.position[i], 6));
  });
});
