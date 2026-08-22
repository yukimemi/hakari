// The shape a meal is edited in, shared by the capture flow and by
// correcting a meal already saved.
//
// Separate from the editor component because Fast Refresh only preserves
// state in modules that export components and nothing else.

import { api, type EncodedImage } from "./api";
import type { MealItem, TaskAssignment } from "../../shared/schema";

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

/**
 * Ask the model to redo the numbers for a list the user has corrected.
 *
 * Name and amount are both sent, and both are taken as given: a row
 * corrected from 「煮豆」 to 「納豆」 is recomputed as natto, not as the
 * beans the photo was read as. The photo rides along when there is one —
 * it cannot overrule a typed row, but once the name has changed it is
 * what the amount can be judged against.
 *
 * Rows are matched by position and only their numbers are replaced, so a
 * model that decides to merge or split items cannot rewrite what the
 * person just typed.
 */
export async function recalculate(
  draft: MealDraft[],
  assignment: TaskAssignment,
  image?: EncodedImage,
): Promise<{ items: MealDraft[]; advice: string }> {
  const items = draft.filter((item) => item.name.trim());
  const res = await api.analyzeMeal({
    assignment,
    image,
    items: items.map((item) => ({ name: item.name, quantity: item.quantity })),
  });

  return {
    advice: res.analysis.advice,
    items: items.map((item, index) => {
      const fresh = res.analysis.items[index];
      if (!fresh) return item;
      // Rounded on arrival. A recomputed 1.65g of protein is not more
      // accurate than 1.7g, it only looks like it is — and the raw value
      // would sit in the input field saying so.
      return {
        ...item,
        kcal: Math.round(fresh.kcal),
        proteinG: Math.round(fresh.proteinG * 10) / 10,
        fatG: Math.round(fresh.fatG * 10) / 10,
        carbsG: Math.round(fresh.carbsG * 10) / 10,
        // A human has now been through this row, so the photo-reading
        // confidence that made it show a warning no longer applies.
        confidence: 1,
      };
    }),
  };
}
