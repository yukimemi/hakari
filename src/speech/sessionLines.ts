// The lines a guided session will speak, worked out before it starts so
// they can be generated and cached ahead of time.
//
// The session's cues are deterministic templates (`workout/cues.ts`), so
// the full set of possible lines for a plan is finite and known up front.
// This module only enumerates them with the same functions the session
// calls at speaking time; it adds no wording of its own. A line that is
// not enumerated here (an adjustment remark, say) is still spoken, by the
// device voice.

import { flatten, type Step } from "../workout/session";
import { paceCue, restCue, startCue, type History } from "../workout/cues";
import type { Prefetchable } from "./teacher";

/** Ceiling on lines generated for one session, so a long plan cannot turn
 *  into an open-ended bill. Start and pace cues come first, as they are
 *  the ones on the clock. */
export const MAX_SESSION_PHRASES = 48;

/** Effort values standing in for the three bands `restCue` words
 *  differently (hard, easy, in between), plus "not rated yet". */
const RPE_VARIANTS = [undefined, 9, 3, 6] as const;

export function sessionPhrases(
  steps: Step[],
  history: History,
  limit = MAX_SESSION_PHRASES,
): Prefetchable[] {
  const queue = flatten(steps);
  const starts: Prefetchable[] = [];
  const paces: Prefetchable[] = [];
  const rests: Prefetchable[] = [];

  queue.forEach((set) => {
    const step = steps[set.stepIndex]!;
    starts.push({ text: startCue(step, set), phase: "exercise" });
    if (set.amount.kind === "reps") {
      for (let paced = 0; paced <= set.amount.count; paced++) {
        const cue = paceCue(set, paced, null);
        if (cue) paces.push({ text: cue.text, phase: "exercise" });
      }
    } else {
      for (const left of [10, 0]) {
        const cue = paceCue(set, 0, left);
        if (cue) paces.push({ text: cue.text, phase: "exercise" });
      }
    }
  });

  // After the last set there is no rest, so no rest line.
  for (let done = 1; done < queue.length; done++) {
    for (const rpe of RPE_VARIANTS) {
      rests.push({
        text: restCue({
          setsDone: done,
          setsTotal: queue.length,
          rpe,
          reduced: false,
          history,
        }),
        phase: "rest",
      });
    }
  }

  const seen = new Set<string>();
  return [...starts, ...paces, ...rests]
    .filter((p) => {
      const key = `${p.phase}\n${p.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

