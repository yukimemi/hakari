// Number formatting shared across screens.
//
// Kept out of the component files so React Fast Refresh can treat those as
// component-only modules.

export function formatKcal(value: number): string {
  return Math.round(value).toLocaleString("ja-JP");
}

export function formatKg(value: number): string {
  return value.toFixed(1);
}

/** Signed calorie delta with a typographic minus, so a negative number
 *  cannot be mistaken for a hyphenated range. */
export function formatSigned(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "±";
  return `${sign}${Math.abs(rounded).toLocaleString("ja-JP")}`;
}
