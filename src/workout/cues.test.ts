import { describe, expect, it } from "vitest";
import { closingFallback, paceCue, restCue, startCue, toHistory, type ClosingFacts, type History } from "./cues";
import type { StoredWorkout } from "../data/store";

const none: History = { status: "ready", sessions: [], activeDays: 0 };
const prior: History = {
  status: "ready",
  sessions: [{ date: "2026-10-01", sets: 4, rpe: 8 }],
  activeDays: 3,
};

const FORM_CLAIM = /(フォーム|姿勢).{0,6}(良|きれい|完璧|バッチリ|OK)|見ていました|見えていました/;

const facts = (over: Partial<ClosingFacts> = {}): ClosingFacts => ({
  setsDone: 5,
  setsPlanned: 6,
  activeMin: 6,
  stoppedEarly: false,
  reduced: false,
  oneSet: false,
  adjustments: [],
  exercises: ["スクワット"],
  history: none,
  ...over,
});

describe("history", () => {
  it("tells loading apart from empty", () => {
    expect(toHistory([], false).status).toBe("loading");
    expect(toHistory([], true)).toEqual({ status: "ready", sessions: [], activeDays: 0 });
  });

  it("compares only guided sessions, but counts every day for attendance", () => {
    const rows = [
      { id: "a", date: "2026-10-05", name: "散歩", kcalBurned: 50 },
      { id: "b", date: "2026-10-06", name: "先生と運動", kcalBurned: 50, source: "session", sets: 3, rpe: 6 },
      { id: "me", date: "2026-10-08", name: "x", kcalBurned: 1, source: "session" },
    ] as StoredWorkout[];
    const h = toHistory(rows, true, "me");
    expect(h).toMatchObject({ status: "ready", activeDays: 2 });
    expect(h.status === "ready" && h.sessions).toHaveLength(1);
  });
});

describe("rest encouragement", () => {
  const base = { setsDone: 1, setsTotal: 4, reduced: false };

  it("makes no comparison while history is loading", () => {
    const t = restCue({ ...base, rpe: 5, history: { status: "loading" } });
    expect(t).not.toContain("前回");
    expect(t).not.toContain("最初");
  });

  it("does not invent progress with no history", () => {
    const t = restCue({ ...base, history: none });
    expect(t).toContain("最初の記録");
    expect(t).not.toContain("前回");
  });

  it("quotes the user's own reports against the last session", () => {
    const t = restCue({ ...base, rpe: 5, history: prior });
    expect(t).toContain("前回の自己申告はきつさ8");
  });

  it("reacts to a hard set without pushing", () => {
    expect(restCue({ ...base, rpe: 9, history: none })).toContain("軽くして");
  });
});

describe("what the teacher never says", () => {
  it("claims no observation of form in any template", () => {
    const lines = [
      startCue(
        { exerciseId: "squat", name: "スクワット", cue: "お尻を引く", sets: 2, amount: { kind: "reps", count: 10 }, restSec: 30 },
        { stepIndex: 0, setNo: 1, setsOfStep: 2, amount: { kind: "reps", count: 10 } },
      ),
      paceCue({ stepIndex: 0, setNo: 1, setsOfStep: 1, amount: { kind: "reps", count: 10 } }, 5, null)!.text,
      restCue({ setsDone: 1, setsTotal: 3, rpe: 3, reduced: true, history: prior }),
      closingFallback(facts({ history: prior })).message,
      closingFallback(facts({ oneSet: true, stoppedEarly: true })).message,
    ];
    for (const line of lines) expect(line).not.toMatch(FORM_CLAIM);
  });
});

describe("closing", () => {
  it("praises coming, and a sensible adjustment", () => {
    const m = closingFallback(facts({ reduced: true })).message;
    expect(m).toContain("来てくれて");
    expect(m).toContain("調整");
  });

  it("praises the one-set start and stopping early without scolding", () => {
    expect(closingFallback(facts({ oneSet: true, setsDone: 1 })).message).toContain("1セット");
    expect(closingFallback(facts({ stoppedEarly: true, setsDone: 2 })).message).toContain("切り上げる判断");
  });

  it("mentions progress only when the record shows it", () => {
    expect(closingFallback(facts({ history: prior, setsDone: 5 })).message).toContain("前回の4セットから5セット");
    expect(closingFallback(facts({ history: { status: "loading" } })).message).not.toContain("前回");
  });

  it("gives a next-session prompt", () => {
    expect(closingFallback(facts({ rpe: 9 })).next).toContain("軽め");
  });
});
