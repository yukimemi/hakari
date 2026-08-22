// Firestore rejects `undefined` outright, and an optional field left unset
// is the normal case here: a weigh-in without a body-fat reading, a meal
// typed in rather than photographed, a task using the provider's default
// model. Every write goes through one of these two on the way out.
//
// The two differ because the question "what does undefined mean?" has two
// answers depending on how the write lands:
//
//   merge  — the document already exists and keeps whatever is not named,
//            so undefined means "stop being set": deleteField().
//   full   — the document is replaced, so there is nothing to erase and
//            deleteField() is illegal anyway: leave the key out.
//
// Getting this wrong is quiet. Dropping the key from a merge write leaves
// the old value in place, so "back to the default model" silently keeps
// the previous model; passing undefined through throws at the call site
// with a message that names a field but not a cause. Both have happened.

import { deleteField } from "firebase/firestore";

/** Only object literals are ours to walk. Timestamps, sentinels such as
 *  serverTimestamp(), Dates and class instances must pass untouched. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * For `setDoc(..., { merge: true })`. Undefined becomes an explicit field
 * deletion, so clearing an optional value actually clears it.
 *
 * Arrays pass through: deleteField() is illegal inside one.
 */
export function forMerge(value: unknown): unknown {
  if (value === undefined) return deleteField();
  if (Array.isArray(value)) return value;
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [key, forMerge(v)]),
  );
}

/**
 * For a whole-document write. Undefined keys are dropped, which is what
 * "not set" means when nothing is being replaced.
 */
export function forWrite<T>(value: T): T {
  if (Array.isArray(value)) return value.map(forWrite) as T;
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([key, v]) => [key, forWrite(v)]),
  ) as T;
}
