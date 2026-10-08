import { describe, expect, it } from "vitest";
import { sessionPhrases } from "./sessionLines";
import { paceCue, startCue } from "../workout/cues";
import { TTS_MAX_CHARS } from "../../shared/tts";
import type { Step } from "../workout/session";

const history = { status: "ready" as const, sessions: [], activeDays: 0 };
const steps: Step[] = [
  { exerciseId: "squat", name: "スクワット", cue: "背すじを伸ばす", sets: 2, amount: { kind: "reps", count: 8 }, restSec: 30 },
  { exerciseId: "plank", name: "プランク", cue: "体を一直線に", sets: 1, amount: { kind: "seconds", seconds: 30 }, restSec: 30 },
];

describe("sessionPhrases", () => {
  const phrases = sessionPhrases(steps, history);

  it("uses the session's own wording for every start and pace cue", () => {
    const texts = phrases.map((p) => p.text);
    expect(texts).toContain(
      startCue(steps[0]!, { stepIndex: 0, setNo: 1, setsOfStep: 2, amount: steps[0]!.amount }),
    );
    expect(texts).toContain(paceCue({ stepIndex: 0, setNo: 1, setsOfStep: 2, amount: steps[0]!.amount }, 7, null)!.text);
    expect(texts).toContain("あと10秒");
  });

  it("puts clocked cues before rest lines and uses the rest delivery for rests", () => {
    const firstRest = phrases.findIndex((p) => p.phase === "rest");
    expect(firstRest).toBeGreaterThan(0);
    expect(phrases.slice(0, firstRest).every((p) => p.phase === "exercise")).toBe(true);
  });

  it("has no duplicates and respects the limit", () => {
    expect(new Set(phrases.map((p) => p.text)).size).toBe(phrases.length);
    expect(sessionPhrases(steps, history, 5)).toHaveLength(5);
  });

  it("makes no rest line for the final set", () => {
    expect(phrases.some((p) => p.phase === "rest" && p.text.startsWith("3セット終わり"))).toBe(false);
  });

  it("keeps lines within the server's per-phase limits", () => {
    const over = phrases.filter((p) => p.text.length > TTS_MAX_CHARS[p.phase]);
    expect(over).toEqual([]);
  });
});
