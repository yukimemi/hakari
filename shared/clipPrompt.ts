// What gets sent to the video model, and how it is put together.
//
// Shared so the box the owner edits shows exactly what the route will
// send. A prompt composed on the server and a preview composed in the
// browser drift the moment either is touched, and a preview that lies
// about the request is worse than no preview.
//
// Short and plain on purpose. Every longer prompt tried against Veo —
// ones naming the camera, the captions, the audio — came back filtered,
// and there is no setting to relax the filter.

import type { ExerciseDef } from "./exercises.js";

/** Long enough to describe a movement and who is doing it, short enough
 *  that a runaway paste cannot become the request. */
export const MAX_CLIP_PROMPT = 600;

export const DEFAULT_CLIP_SUBJECT = "A Japanese woman in sportswear";

export function clipPrompt(exercise: ExerciseDef, subject?: string): string {
  const who = subject?.trim() || "A person";
  return `${who} doing ${exercise.english} in a bright gym. Full body in frame.`;
}
