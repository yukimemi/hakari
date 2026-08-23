// @vitest-environment jsdom
//
// currentKg on this widget is sometimes a raw reading (the SignIn demo)
// and sometimes a smoothed trend value (the dashboard, via useTargets).
// A user who sees the needle disagree with what they weighed in today
// needs a reason on screen for that, so `currentLabel`/`currentHint` were
// added — this locks in that they render when passed and stay silent
// (no extra text, no tooltip) when omitted, so the SignIn preview keeps
// its current look.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import BeamScale from "./BeamScale";

afterEach(cleanup);

describe("BeamScale", () => {
  it("prints no caption or tooltip when currentLabel/currentHint are omitted", () => {
    render(<BeamScale startKg={82.5} currentKg={78.2} targetKg={68} />);
    expect(screen.queryByText("TREND")).toBeNull();
    expect(document.querySelector("title")).toBeNull();
  });

  it("prints the caption and exposes the hint as a tooltip when given", () => {
    render(
      <BeamScale
        startKg={82.5}
        currentKg={78.2}
        targetKg={68}
        currentLabel="TREND"
        currentHint="7日移動平均です。"
      />,
    );
    expect(screen.getByText("TREND")).toBeTruthy();
    expect(document.querySelector("title")?.textContent).toBe("7日移動平均です。");
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
      "7日移動平均です。",
    );
  });
});
