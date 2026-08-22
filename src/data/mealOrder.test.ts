// The day's meals read newest first, and the fallback for meals written
// before `createdAt` existed is the part worth pinning down.

import { describe, expect, it } from "vitest";
import { newestFirst, type StoredMeal } from "./store";
import type { Timestamp } from "firebase/firestore";

const at = (ms: number) => ({ toMillis: () => ms }) as Timestamp;

const meal = (
  id: string,
  slot: StoredMeal["slot"],
  createdAt?: Timestamp,
): StoredMeal => ({
  id,
  slot,
  createdAt,
  date: "2026-08-22",
  items: [],
  totalKcal: 0,
  source: "manual",
});

const order = (meals: StoredMeal[]) =>
  [...meals].sort(newestFirst).map((m) => m.id);

describe("newestFirst", () => {
  it("puts the most recently written meal first", () => {
    expect(
      order([
        meal("morning", "breakfast", at(1000)),
        meal("evening", "dinner", at(3000)),
        meal("midday", "lunch", at(2000)),
      ]),
    ).toEqual(["evening", "midday", "morning"]);
  });

  it("keeps a snack where it was logged, not at one end", () => {
    expect(
      order([
        meal("breakfast", "breakfast", at(1000)),
        meal("snack", "snack", at(2000)),
        meal("dinner", "dinner", at(3000)),
      ]),
    ).toEqual(["dinner", "snack", "breakfast"]);
  });

  it("falls back to the day reversed when nothing is dated", () => {
    expect(
      order([
        meal("b", "breakfast"),
        meal("s", "snack"),
        meal("d", "dinner"),
        meal("l", "lunch"),
      ]),
    ).toEqual(["s", "d", "l", "b"]);
  });

  it("sorts dated meals above undated ones", () => {
    // Anything dated was written after the change, so it is newer than
    // anything that was not — regardless of which slot it sits in.
    expect(
      order([meal("old-dinner", "dinner"), meal("new-breakfast", "breakfast", at(1))]),
    ).toEqual(["new-breakfast", "old-dinner"]);
  });
});
