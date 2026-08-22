// Which generated clip stands as the demonstration for each exercise.
//
// Shared, not personal: a clip of a squat is a clip of a squat. The owner
// generates and adopts; everyone else watches whatever was adopted. That
// asymmetry is the same one the invite list draws, and for the same
// reason — the button costs money each time it is pressed.

import { doc, onSnapshot, setDoc, type Unsubscribe } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../lib/firebase";
import { deletePhoto, photoUrl } from "./store";
import { forMerge } from "./sanitise";

export type ClipRef = {
  /** Storage path of the adopted take. */
  path: string;
  generatedAt: string;
  /** The words that produced it. Kept so the next attempt starts from
   *  what worked rather than from the generic default — the difference
   *  between a clip of the right exercise and another lottery ticket. */
  prompt?: string;
};

export type Clips = Record<string, ClipRef>;

const clipsRef = () => doc(db(), "config", "clips");

export function watchClips(
  onChange: (clips: Clips) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    clipsRef(),
    (snap) => onChange(((snap.data() as { clips?: Clips })?.clips ?? {}) as Clips),
    onError,
  );
}

export function useClips(): Clips {
  const [clips, setClips] = useState<Clips>({});
  useEffect(
    () =>
      watchClips(setClips, () => {
        // A guest who cannot read the document simply has no clips, which
        // is the same as none having been adopted yet.
        setClips({});
      }),
    [],
  );
  return clips;
}

/** Adopts a take, and removes the one it replaces so unadopted footage
 *  does not pile up in storage. */
export async function adoptClip(
  exerciseId: string,
  take: { path: string; prompt: string },
  previous?: string,
): Promise<void> {
  await setDoc(
    clipsRef(),
    forMerge({
      clips: {
        [exerciseId]: {
          path: take.path,
          prompt: take.prompt,
          generatedAt: new Date().toISOString(),
        },
      },
    }) as Record<string, unknown>,
    { merge: true },
  );
  if (previous && previous !== take.path) {
    try {
      await deletePhoto(previous);
    } catch {
      /* already gone */
    }
  }
}

export async function discardClip(path: string): Promise<void> {
  try {
    await deletePhoto(path);
  } catch {
    /* already gone */
  }
}

export const clipUrl = photoUrl;
