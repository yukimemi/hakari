// Firestore access layer.
//
// Layout:
//   users/{uid}                  profile + goal + settings + latest body read
//   users/{uid}/weights/{date}   one doc per day, id = yyyy-MM-dd
//   users/{uid}/meals/{id}
//   users/{uid}/workouts/{id}
//   users/{uid}/bodyPhotos/{id}
//
// Profile, goal and settings share the user document so the app boots on
// a single read. The logs are subcollections because they grow without
// bound and are always queried by date range.

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import {
  getDownloadURL,
  ref,
  uploadBytes,
  deleteObject,
} from "firebase/storage";
import { db, storage } from "../lib/firebase";
import {
  DEFAULT_SETTINGS,
  type BodyAnalysis,
  type CoachComment,
  type Goal,
  type MealEntry,
  type Profile,
  type Settings,
  type WeightEntry,
  type WorkoutEntry,
  type WorkoutPlan,
} from "../../shared/schema";
import { ACCESS_DOC, type AccessDoc } from "../../shared/access";
import { forMerge, forWrite } from "./sanitise";

/** How an analysis reads back out of Firestore, as opposed to what the
 *  model is required to return. Documents are never migrated, so anything
 *  written before a field existed simply lacks it — `estimatedWaistCm` is
 *  absent on every analysis stored before it was added to the schema, and
 *  callers have to handle that rather than trust the LLM contract. */
export type StoredBodyAnalysis = Omit<BodyAnalysis, "estimatedWaistCm"> & {
  estimatedWaistCm?: number;
};

export type UserDoc = {
  profile?: Profile;
  goal?: Goal;
  settings?: Settings;
  /** Result of the most recent body-photo analysis. */
  body?: StoredBodyAnalysis & { photoPath?: string; analyzedAt?: string };
  plan?: WorkoutPlan & { generatedAt?: string };
  /** The dashboard one-liner. Stored with the day it was written for, so
   *  a stale comment from yesterday is recognisable as stale rather than
   *  presented as today's. */
  coach?: CoachComment & { date: string };
};

const userRef = (uid: string) => doc(db(), "users", uid);

const accessRef = () => doc(db(), ACCESS_DOC.collection, ACCESS_DOC.id);

/** The invite list. Readable by anyone already on it, writable by the
 *  owner — a permission error here is how a guest learns they are not on
 *  it, so the caller treats `onError` as "denied", not as a fault. */
export function watchAccess(
  onChange: (data: AccessDoc) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    accessRef(),
    (snap) => onChange((snap.data() as AccessDoc | undefined) ?? {}),
    onError,
  );
}

export async function saveAllowedEmails(emails: string[]): Promise<void> {
  await setDoc(
    accessRef(),
    { allowedEmails: emails, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export function watchUser(
  uid: string,
  onChange: (data: UserDoc) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    userRef(uid),
    (snap) => onChange((snap.data() as UserDoc | undefined) ?? {}),
    onError,
  );
}

export async function readUser(uid: string): Promise<UserDoc> {
  const snap = await getDoc(userRef(uid));
  return (snap.data() as UserDoc | undefined) ?? {};
}

/** Merge-writes a slice of the user document. */
export async function saveUserSlice(
  uid: string,
  slice: Partial<UserDoc>,
): Promise<void> {
  const payload = forMerge({ ...slice }) as Record<string, unknown>;
  await setDoc(
    userRef(uid),
    { ...payload, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export const saveProfile = (uid: string, profile: Profile) =>
  saveUserSlice(uid, { profile });

export const saveGoal = (uid: string, goal: Goal) => saveUserSlice(uid, { goal });

export const saveSettings = (uid: string, settings: Settings) =>
  saveUserSlice(uid, { settings });

export function settingsOf(user: UserDoc): Settings {
  // Merge rather than replace: a settings doc written before a new field
  // existed must not leave that field undefined.
  return {
    ...DEFAULT_SETTINGS,
    ...user.settings,
    ai: { ...DEFAULT_SETTINGS.ai, ...user.settings?.ai },
    training: { ...DEFAULT_SETTINGS.training, ...user.settings?.training },
  };
}

// ---------------------------------------------------------------------------
// Weights — one document per day
// ---------------------------------------------------------------------------

export function watchWeights(
  uid: string,
  onChange: (entries: WeightEntry[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db(), "users", uid, "weights"),
    orderBy("date", "asc"),
  );
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => d.data() as WeightEntry)),
    onError,
  );
}

export async function saveWeight(
  uid: string,
  entry: WeightEntry,
): Promise<void> {
  await setDoc(doc(db(), "users", uid, "weights", entry.date), {
    ...forWrite(entry),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteWeight(uid: string, date: string): Promise<void> {
  await deleteDoc(doc(db(), "users", uid, "weights", date));
}

// ---------------------------------------------------------------------------
// Meals
// ---------------------------------------------------------------------------

/** `createdAt` is the ordering key. Absent on meals written before it
 *  existed, which is why the comparator has a fallback. */
export type StoredMeal = MealEntry & { id: string; createdAt?: Timestamp };

const SLOT_ORDER = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 } as const;

/**
 * Newest first — the meal just logged is the one being looked at.
 *
 * Meals from before `createdAt` was recorded fall back to the order a day
 * is eaten in, reversed. They sort below the dated ones, which is right:
 * anything dated was written after the change, so it is newer than
 * anything that was not.
 */
export function newestFirst(a: StoredMeal, b: StoredMeal): number {
  const at = a.createdAt?.toMillis();
  const bt = b.createdAt?.toMillis();
  if (at !== undefined && bt !== undefined) return bt - at;
  if (at !== undefined) return -1;
  if (bt !== undefined) return 1;
  return SLOT_ORDER[b.slot] - SLOT_ORDER[a.slot];
}

export function watchMeals(
  uid: string,
  date: string,
  onChange: (meals: StoredMeal[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db(), "users", uid, "meals"),
    where("date", "==", date),
  );
  return onSnapshot(
    q,
    (snap) =>
      onChange(
        snap.docs
          // A `serverTimestamp()` reads back as null until the server
          // confirms it, so without an estimate a meal would appear at
          // the bottom of the list and jump to the top a moment later.
          .map((d) => ({
            id: d.id,
            ...(d.data({ serverTimestamps: "estimate" }) as MealEntry & {
              createdAt?: Timestamp;
            }),
          }))
          .sort(newestFirst),
      ),
    onError,
  );
}

export function watchMealsInRange(
  uid: string,
  fromDate: string,
  toDate: string,
  onChange: (meals: StoredMeal[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db(), "users", uid, "meals"),
    where("date", ">=", fromDate),
    where("date", "<=", toDate),
  );
  return onSnapshot(
    q,
    (snap) =>
      onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as MealEntry) }))),
    onError,
  );
}

export async function saveMeal(
  uid: string,
  meal: MealEntry & { createdAt?: Timestamp },
  id?: string,
): Promise<string> {
  const target = id
    ? doc(db(), "users", uid, "meals", id)
    : doc(collection(db(), "users", uid, "meals"));
  await setDoc(target, {
    ...forWrite(meal),
    // Stamped once, when the meal is first written. Correcting a typo an
    // hour later should not shuffle breakfast above dinner.
    createdAt: meal.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return target.id;
}

export async function deleteMeal(
  uid: string,
  id: string,
  photoPath?: string,
): Promise<void> {
  await deleteDoc(doc(db(), "users", uid, "meals", id));
  // The photo goes with the record. Leaving it behind would mean deleting
  // a meal you would rather not keep still leaves the picture of it in
  // storage. Best effort: a dangling object must not block the delete the
  // user asked for.
  if (!photoPath) return;
  try {
    await deletePhoto(photoPath);
  } catch {
    /* already gone */
  }
}

// ---------------------------------------------------------------------------
// Workouts
// ---------------------------------------------------------------------------

export type StoredWorkout = WorkoutEntry & { id: string };

export function watchWorkoutsInRange(
  uid: string,
  fromDate: string,
  toDate: string,
  onChange: (items: StoredWorkout[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db(), "users", uid, "workouts"),
    where("date", ">=", fromDate),
    where("date", "<=", toDate),
  );
  return onSnapshot(
    q,
    (snap) =>
      onChange(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as WorkoutEntry) })),
      ),
    onError,
  );
}

export async function saveWorkout(
  uid: string,
  workout: WorkoutEntry,
  id?: string,
): Promise<string> {
  const target = id
    ? doc(db(), "users", uid, "workouts", id)
    : doc(collection(db(), "users", uid, "workouts"));
  await setDoc(target, {
    ...forWrite(workout),
    updatedAt: serverTimestamp(),
  });
  return target.id;
}

export async function deleteWorkout(uid: string, id: string): Promise<void> {
  await deleteDoc(doc(db(), "users", uid, "workouts", id));
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

/** Uploads to `users/{uid}/{kind}/{name}` and returns the storage path.
 *  Storage rules restrict this prefix to the owning user. */
export async function uploadPhoto(
  uid: string,
  kind: "meals" | "body",
  blob: Blob,
  name: string,
): Promise<string> {
  const path = `users/${uid}/${kind}/${name}`;
  await uploadBytes(ref(storage(), path), blob, {
    contentType: blob.type || "image/jpeg",
  });
  return path;
}

export function photoUrl(path: string): Promise<string> {
  return getDownloadURL(ref(storage(), path));
}

export async function deletePhoto(path: string): Promise<void> {
  await deleteObject(ref(storage(), path));
}

export type BodyPhotoRecord = {
  id: string;
  date: string;
  photoPath: string;
  weightKg?: number;
  analysis?: StoredBodyAnalysis;
  /** Upload time. `date` is day-granular, so this is what separates two
   *  photos taken on the same day — without it Firestore breaks the tie
   *  by document id, and anything reading a "since the last photo" delta
   *  off this list can then read it backwards. Absent on photos written
   *  before it existed, which is why the comparator has a fallback. */
  createdAt?: Timestamp;
};

export function watchBodyPhotos(
  uid: string,
  onChange: (items: BodyPhotoRecord[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db(), "users", uid, "bodyPhotos"),
    orderBy("date", "asc"),
  );
  return onSnapshot(
    q,
    (snap) =>
      onChange(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as BodyPhotoRecord)
          // Ordering by both fields server-side would need a composite
          // index, and the whole collection is already in hand.
          .sort(
            (a, b) =>
              a.date.localeCompare(b.date) ||
              (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0),
          ),
      ),
    onError,
  );
}

export async function saveBodyPhoto(
  uid: string,
  record: Omit<BodyPhotoRecord, "id">,
): Promise<string> {
  const target = doc(collection(db(), "users", uid, "bodyPhotos"));
  await setDoc(target, {
    ...forWrite(record),
    createdAt: serverTimestamp(),
  });
  return target.id;
}

/** Corrects a stored record. The photo and the reading the model made
 *  from it stay as they were: the two things a person knows better than
 *  the record are which day it was and what they weighed that morning. */
export async function updateBodyPhoto(
  uid: string,
  id: string,
  patch: { date: string; weightKg?: number },
): Promise<void> {
  await updateDoc(doc(db(), "users", uid, "bodyPhotos", id), {
    // forMerge, not forWrite: clearing the weight has to erase the field
    // rather than leave the old number sitting under the photo.
    ...(forMerge(patch) as Record<string, unknown>),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteBodyPhoto(
  uid: string,
  record: BodyPhotoRecord,
): Promise<void> {
  await deleteDoc(doc(db(), "users", uid, "bodyPhotos", record.id));
  // Best effort: a dangling object costs storage but must not block the
  // delete the user asked for.
  try {
    await deletePhoto(record.photoPath);
  } catch {
    /* already gone */
  }
}
