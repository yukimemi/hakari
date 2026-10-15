// "曲に合わせて": a workout laid over a song the user picked.
//
// Contract between the browser, which analyses the song and plays the
// program, and /api/groove-plan, which only chooses exercises. The model
// never sees audio or times beats: it gets the song's shape (sections,
// how hard each one hits) and returns one exercise per section. Rep tempo
// and every timing is computed from the beat grid in `src/groove/`.

import { z } from "zod";

export const GROOVE_LEVELS = ["low", "mid", "high"] as const;
export type GrooveLevel = (typeof GROOVE_LEVELS)[number];

/** Warm-up and cool-down are the first and last sections, kept gentle
 *  whatever the music does there. */
export const GROOVE_ROLES = ["warmup", "main", "cooldown"] as const;
export type GrooveRole = (typeof GROOVE_ROLES)[number];

/** One section as the model sees it. */
export const GrooveSectionBrief = z.object({
  index: z.number().int().min(0),
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  level: z.enum(GROOVE_LEVELS),
  role: z.enum(GROOVE_ROLES),
});
export type GrooveSectionBrief = z.infer<typeof GrooveSectionBrief>;

/** Most sections a song is split into. Eight bars of 4/4 at 60 BPM is 32 s,
 *  so this covers any song under half an hour. */
export const MAX_GROOVE_SECTIONS = 60;

/** What the model returns. */
export const GroovePlan = z.object({
  picks: z
    .array(
      z.object({
        section: z.number().describe("区間の index"),
        exerciseId: z.string().describe("与えられた種目リストの id のいずれか"),
      }),
    )
    .describe("区間ごとに1つ。全区間を埋める"),
  note: z.string().describe("このプログラムの狙いを一言。60字以内。日本語"),
});
export type GroovePlan = z.infer<typeof GroovePlan>;

/** The beat grid as stored, so a program re-opens without re-decoding. */
export const GrooveAnalysis = z.object({
  bpm: z.number().min(30).max(300),
  beats: z.array(z.number()).min(8),
  /** Index into `beats` of the first beat of the first full bar. */
  downbeat: z.number().int().min(0),
  /** RMS between each beat and the next, aligned with `beats`. */
  beatEnergy: z.array(z.number()),
  /** User correction applied to every beat time, in seconds. */
  offsetSec: z.number().min(-2).max(2).default(0),
});
export type GrooveAnalysis = z.infer<typeof GrooveAnalysis>;

/** `users/{uid}/grooves/{songId}`, where songId is the SHA-256 of the file.
 *  The song itself never leaves the device. */
export const GrooveDoc = z.object({
  title: z.string().max(200),
  durationSec: z.number().min(1).max(3600),
  analysis: GrooveAnalysis,
  /** Exercise id per section, in section order. A missing or unusable one
   *  is filled by the rule-based picker at load time. */
  picks: z.array(z.string()),
  source: z.enum(["ai", "rule"]),
  note: z.string().max(300).optional(),
});
export type GrooveDoc = z.infer<typeof GrooveDoc>;
