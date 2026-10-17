import { describe, expect, it } from "vitest";
import type { GrooveAnalysis } from "../../shared/groove";
import {
  beatAt,
  beatsPerRep,
  buildProgram,
  buildSections,
  cuesFor,
  gridOf,
  poseAt,
  rulePicks,
  timeOfBeat,
  type PickOptions,
} from "./choreo";

/** A steady grid: `count` beats at `bpm`, the first at `start`. */
function steady(opts: {
  bpm: number;
  count: number;
  start?: number;
  downbeat?: number;
  energy?: (i: number) => number;
  offsetSec?: number;
}): GrooveAnalysis {
  const beat = 60 / opts.bpm;
  return {
    bpm: opts.bpm,
    beats: Array.from({ length: opts.count }, (_, i) => (opts.start ?? 0.5) + i * beat),
    downbeat: opts.downbeat ?? 0,
    beatEnergy: Array.from({ length: opts.count }, (_, i) => opts.energy?.(i) ?? 0.2),
    offsetSec: opts.offsetSec ?? 0,
  };
}

const HOME: PickOptions = { equipment: ["none", "mat"], experience: "intermediate", constraints: "" };

describe("grid", () => {
  it("maps time to beat and back, past both ends", () => {
    const grid = gridOf(steady({ bpm: 120, count: 16 }));
    for (const t of [0, 0.5, 1.37, 8.25, 9.9]) {
      expect(timeOfBeat(grid, beatAt(grid, t))).toBeCloseTo(t, 9);
    }
    expect(beatAt(grid, 0)).toBeCloseTo(-1, 9);
    expect(beatAt(grid, 8 + 1.5)).toBeCloseTo(18, 9);
  });

  it("applies the user's offset to every beat", () => {
    const grid = gridOf(steady({ bpm: 120, count: 8, offsetSec: 0.04 }));
    expect(grid[0]).toBeCloseTo(0.54, 9);
    expect(grid[7]).toBeCloseTo(4.04, 9);
  });
});

describe("buildSections", () => {
  it("cuts eight-bar sections from the downbeat and folds a short tail in", () => {
    // 2 pickup beats, then 3 full sections and a 2-bar stub.
    const sections = buildSections(steady({ bpm: 120, count: 2 + 96 + 8, downbeat: 2 }));
    expect(sections.map((s) => [s.startBeat, s.endBeat])).toEqual([
      [2, 34],
      [34, 66],
      [66, 106],
    ]);
  });

  it("keeps a tail of four bars or more as its own section", () => {
    const sections = buildSections(steady({ bpm: 120, count: 64 + 16 }));
    expect(sections.at(-1)).toMatchObject({ startBeat: 64, endBeat: 80 });
  });

  it("ranks loudness into levels, with gentle ends", () => {
    const loudness = [0.3, 0.1, 0.5, 0.9, 0.3, 0.9];
    const sections = buildSections(
      steady({ bpm: 120, count: 32 * loudness.length, energy: (i) => loudness[Math.floor(i / 32)]! }),
    );
    expect(sections.map((s) => s.role)).toEqual(["warmup", "main", "main", "main", "main", "cooldown"]);
    expect(sections.map((s) => s.level)).toEqual(["low", "low", "mid", "high", "low", "low"]);
  });

  it("treats a song that never changes level as all mid", () => {
    const sections = buildSections(steady({ bpm: 120, count: 32 * 4 }));
    expect(sections.slice(1, -1).every((s) => s.level === "mid")).toBe(true);
  });
});

describe("beatsPerRep", () => {
  it("picks the whole-beat count nearest the authored rep speed", () => {
    const beat = 60 / 128;
    // squat is authored at 3 s: 8 beats (3.75 s) beats 4 (1.9 s).
    expect(beatsPerRep("squat", "mid", beat)).toBe(8);
    // jumping jacks at 1.2 s: 2 beats (0.94 s).
    expect(beatsPerRep("jumping-jack", "high", beat)).toBe(2);
    // The same move goes quicker in a hot section of a fast song.
    expect(beatsPerRep("walk", "mid", 60 / 170)).toBe(4);
    expect(beatsPerRep("walk", "high", 60 / 170)).toBe(2);
  });
});

describe("poseAt", () => {
  const analysis = steady({ bpm: 120, count: 4 + 64, downbeat: 4, start: 2 });
  const sections = buildSections(analysis);
  const program = buildProgram(analysis, sections, ["squat", "jumping-jack"], 60);

  it("idles before the first downbeat and after the last section", () => {
    expect(poseAt(program, 1).exerciseId).toBeUndefined();
    expect(poseAt(program, 3.9).exerciseId).toBeUndefined();
    expect(poseAt(program, 59).segment).toBe(2);
    expect(poseAt(program, 59).exerciseId).toBeUndefined();
  });

  it("starts every rep exactly on a beat", () => {
    const [first, second] = program.segments;
    for (const segment of [first!, second!]) {
      for (let b = segment.startBeat; b < segment.endBeat; b += segment.beatsPerRep) {
        const pose = poseAt(program, timeOfBeat(program.grid, b));
        expect(pose.exerciseId).toBe(segment.exerciseId);
        expect(pose.phase).toBeCloseTo(Math.round(pose.phase), 9);
      }
    }
    // Half a beat into a 2-beat jumping jack is a quarter of the rep.
    const mid = timeOfBeat(program.grid, second!.startBeat + 0.5);
    expect(poseAt(program, mid).phase).toBeCloseTo(0.5 / second!.beatsPerRep, 9);
  });

  it("stops at the end of the song even if the grid runs on", () => {
    const short = buildProgram(analysis, sections, ["squat", "jumping-jack"], 20);
    expect(poseAt(short, 20.5).exerciseId).toBeUndefined();
  });
});

describe("rulePicks", () => {
  const sections = buildSections(
    steady({ bpm: 128, count: 32 * 8, energy: (i) => [0.2, 0.3, 0.9, 0.5, 0.9, 0.3, 0.8, 0.2][Math.floor(i / 32)]! }),
  );

  it("never repeats an exercise back to back and only uses what is at hand", () => {
    const picks = rulePicks(sections, { ...HOME, equipment: ["none"] });
    expect(picks).toHaveLength(sections.length);
    picks.slice(1).forEach((id, i) => expect(id).not.toBe(picks[i]));
    for (const id of picks) {
      expect(["dumbbell-row", "dumbbell-press", "chair-dip", "plank", "crunch"]).not.toContain(id);
    }
  });

  it("drops jumping when the user's constraints rule it out", () => {
    const picks = rulePicks(sections, { ...HOME, constraints: "マンションなのでジャンプ禁止" });
    expect(picks).not.toContain("jumping-jack");
    expect(picks).not.toContain("burpee");
  });

  it("keeps a usable pick it was given and replaces an unusable one", () => {
    const given = ["squat", "not-an-exercise", "dumbbell-row"];
    const picks = rulePicks(sections, HOME, given);
    expect(picks[0]).toBe("squat");
    expect(picks[1]).not.toBe("not-an-exercise");
    expect(picks[2]).not.toBe("dumbbell-row");
  });
});

describe("cuesFor", () => {
  const analysis = steady({ bpm: 120, count: 32 * 3, start: 4 });
  const sections = buildSections(analysis);

  it("counts the change in on the three beats before it", () => {
    const program = buildProgram(analysis, sections, ["walk", "squat", "plank"], 60);
    const counts = cuesFor(program).filter((c) => c.key.startsWith("count:1:"));
    expect(counts.map((c) => c.text)).toEqual(["3", "2", "1"]);
    expect(counts.map((c) => c.atSec)).toEqual(
      [3, 2, 1].map((n) => timeOfBeat(program.grid, program.segments[1]!.startBeat - n)),
    );
    const announce = cuesFor(program).find((c) => c.key === "announce:1")!;
    expect(announce.text).toBe("次はスクワット");
    expect(announce.atSec).toBeLessThan(counts[0]!.atSec);
  });

  it("says nothing when a section keeps the same exercise", () => {
    const program = buildProgram(analysis, sections, ["walk", "walk", "plank"], 60);
    const keys = cuesFor(program).map((c) => c.key);
    expect(keys.some((k) => k === "announce:1" || k.startsWith("count:1:"))).toBe(false);
    expect(keys).toContain("announce:2");
    expect(cuesFor(program).at(-1)).toMatchObject({ key: "closing", kind: "closing" });
  });
});
