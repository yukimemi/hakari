// The shape a meal is edited in, shared by the capture flow and by
// correcting a meal already saved.
//
// Separate from the editor component because Fast Refresh only preserves
// state in modules that export components and nothing else.

import type { MealItem } from "../../shared/schema";

/** A meal item while it is being edited. `confidence` rides along from the
 *  photo analysis so the form can flag a reading it is unsure about; a row
 *  typed by hand has none. */
export type MealDraft = MealItem & { confidence?: number };

export const BLANK: MealDraft = {
  name: "",
  quantity: "",
  kcal: 0,
  proteinG: 0,
  fatG: 0,
  carbsG: 0,
  confidence: 1,
};
