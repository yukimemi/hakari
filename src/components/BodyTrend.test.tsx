// @vitest-environment jsdom
//
// The waist series is younger than the photo history: analyses stored
// before `estimatedWaistCm` existed do not have it, and Firestore
// documents are never migrated. So "前回から" for the waist means the
// previous photo *that carries a waist*, which is not always the previous
// photo — and that is the rule a later refactor is most likely to flatten
// back into `points.at(-2)`.
//
// Asserted through the rendered readings rather than by calling a helper,
// because the pairing of a label with the right delta is the thing that
// would be wrong on screen.

import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import BodyTrend from "./BodyTrend";
import type { BodyPhotoRecord } from "../data/store";

const shape = { shoulder: 0, chest: 0, waist: 0.8, hip: 0, thigh: 0, arm: 0 };

function photo(
  date: string,
  fat: number,
  waistCm?: number,
): BodyPhotoRecord {
  return {
    id: date,
    date,
    photoPath: `users/u/body/${date}.jpg`,
    analysis: {
      bodyType: "りんご型",
      estimatedBodyFatPct: fat,
      ...(waistCm === undefined ? {} : { estimatedWaistCm: waistCm }),
      shape,
      focusAreas: ["腹部"],
      comment: "c",
    },
  };
}

/** The readings are label-above-value pairs, so the value is read off the
 *  labelled block rather than by index. Both series use "前回から", which
 *  is why this scopes to the block containing the series' own heading. */
function reading(label: string): string {
  const node = screen.getAllByText(label)[0]!.parentElement!;
  return node.textContent!.replace(label, "").trim();
}

afterEach(cleanup);

describe("BodyTrend", () => {
  it("says nothing can be compared yet when no photo is analysed", () => {
    render(<BodyTrend photos={[]} />);
    expect(screen.getByText("まだ比べられません")).toBeTruthy();
  });

  it("holds the waist blank while only pre-field analyses exist", () => {
    render(
      <BodyTrend
        photos={[photo("2026-08-22", 27), photo("2026-08-23", 28)]}
      />,
    );

    expect(reading("推定ウエスト")).toBe("—");
    // The body-fat delta still works — the two series are independent.
    expect(reading("推定体脂肪率")).toContain("28.0");
    expect(screen.getByText(/次に撮った写真から/)).toBeTruthy();
    // The caption has to describe the chart that is actually on screen:
    // with no waist anywhere, no waist line is drawn, so naming a red
    // line would be pointing at nothing.
    expect(screen.queryByText(/赤い線/)).toBeNull();
    expect(screen.getByText(/灰色の線/)).toBeTruthy();
  });

  it("measures the waist delta against the last photo that has one", () => {
    render(
      <BodyTrend
        photos={[
          photo("2026-08-22", 27),
          photo("2026-08-23", 28),
          photo("2026-09-05", 26.4, 96.5),
          photo("2026-09-20", 25.1, 94.0),
        ]}
      />,
    );

    expect(reading("推定ウエスト")).toContain("94.0");
    // 94.0 - 96.5, i.e. skipping the two waistless photos entirely rather
    // than treating the immediately previous photo as 0.
    expect(reading("前回から")).toContain("−2.5");
    expect(screen.queryByText(/次に撮った写真から/)).toBeNull();
  });

  it("leaves the since-first delta blank on a lone waist reading", () => {
    render(
      <BodyTrend
        photos={[photo("2026-08-22", 27), photo("2026-09-05", 26.4, 96.5)]}
      />,
    );

    expect(reading("推定ウエスト")).toContain("96.5");
    // One waist reading is not a trend: there is nothing behind it to
    // subtract, and showing ±0.0 would read as "no change".
    expect(reading("開始から")).toBe("—");
    // Two photos means a chart, and one waist reading is enough to draw
    // the waist mark — so naming it is correct here.
    expect(screen.getByText(/赤い線/)).toBeTruthy();
  });

  it("describes no line at all when a single photo replaces the chart", () => {
    render(<BodyTrend photos={[photo("2026-09-05", 26.4, 96.5)]} />);

    expect(screen.getByText(/記録は1枚だけです/)).toBeTruthy();
    expect(screen.queryByText(/赤い線/)).toBeNull();
    expect(screen.queryByText(/灰色/)).toBeNull();
    // The waist caveat is not about the chart, so it stays: a waist
    // number is on screen in the readings and needs its qualifier.
    expect(screen.getByText(/記録した体重にも引っぱられます/)).toBeTruthy();
  });
});
