import { describe, expect, it, vi } from "vitest";

vi.mock("firebase/firestore", () => ({
  deleteField: () => ({ __delete: true }),
}));

const { forMerge, forWrite } = await import("./sanitise");

const isDelete = (value: unknown) =>
  typeof value === "object" && value !== null && "__delete" in value;

describe("forWrite", () => {
  it("drops keys that are not set", () => {
    // A weigh-in with no body-fat reading. Passing it through untouched is
    // what produced "Unsupported field value: undefined (found in field
    // bodyFatPct)" at the moment of saving.
    const entry = { date: "2026-08-22", weightKg: 87.4, bodyFatPct: undefined };
    expect(forWrite(entry)).toEqual({ date: "2026-08-22", weightKg: 87.4 });
    expect("bodyFatPct" in (forWrite(entry) as object)).toBe(false);
  });

  it("keeps the values that are set, including falsy ones", () => {
    expect(forWrite({ kcal: 0, note: "", ok: false })).toEqual({
      kcal: 0,
      note: "",
      ok: false,
    });
  });

  it("reaches into nested objects and arrays", () => {
    const meal = {
      items: [{ name: "白米", kcal: 390, note: undefined }],
      photoPath: undefined,
    };
    expect(forWrite(meal)).toEqual({ items: [{ name: "白米", kcal: 390 }] });
  });

  it("leaves things it does not own alone", () => {
    const date = new Date(0);
    expect((forWrite({ at: date }) as { at: Date }).at).toBe(date);
  });
});

describe("forMerge", () => {
  it("turns an unset field into a deletion, not an omission", () => {
    // Dropping the key instead would leave the previously chosen model in
    // place — picking "the default model" would appear not to save.
    const merged = forMerge({ ai: { meal: { provider: "google", model: undefined } } });
    const model = (merged as { ai: { meal: { model: unknown } } }).ai.meal.model;
    expect(isDelete(model)).toBe(true);
  });

  it("leaves set values alone", () => {
    expect(forMerge({ provider: "google" })).toEqual({ provider: "google" });
  });

  it("does not put a deletion inside an array, where it is illegal", () => {
    const list = ["a@example.com"];
    expect(forMerge({ allowedEmails: list })).toEqual({ allowedEmails: list });
  });
});
