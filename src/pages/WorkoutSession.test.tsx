// @vitest-environment jsdom
//
// The session's speech lifecycle, with the teacher replaced by a recorder so
// what is asserted is *when* the screen asks it to speak, cut or prefetch:
//
//   - a change of scene interrupts before the next cue is queued, but the
//     first tap's start cue is left alone,
//   - closing words that arrive after stopping, leaving or continuing never
//     speak, while ones that arrive in time still do,
//   - only the chosen plan is prefetched, and within a bound.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const prefetches: { text: string; phase: string }[][] = [];
const teacherMock = vi.hoisted(() => ({
  say: vi.fn(),
  interrupt: vi.fn(),
  stop: vi.fn(),
  pause: vi.fn(),
  cancel: vi.fn(),
  unlock: vi.fn(async () => {}),
  setGeminiEnabled: vi.fn(),
  onSpeakingChange: vi.fn(() => () => {}),
  prefetch: vi.fn<(phrases: { text: string; phase: string }[]) => Promise<{ cached: number; failed: number }>>(
    async () => ({ cached: 0, failed: 0 }),
  ),
}));
const coach = vi.hoisted(() => ({ resolve: undefined as undefined | ((v: unknown) => void) }));

vi.mock("../auth/context", () => ({ useUid: () => "u1" }));
vi.mock("../data/hooks", () => ({
  useRecentLogs: () => ({ workouts: [], workoutsLoaded: true }),
}));
vi.mock("../data/store", () => ({ saveWorkout: vi.fn(async () => {}) }));
vi.mock("../avatar/AvatarStage", () => ({ default: () => null }));
vi.mock("../lib/wakeLock", () => ({ useWakeLock: () => {} }));
vi.mock("../audio/mixer", () => ({
  Mixer: class {
    unlock() {}
    setEnabled() {}
    setFile() {}
    play() {}
    stop() {}
    dispose() {}
    duck() {}
    release() {}
  },
  speakDucked: vi.fn(),
}));
vi.mock("../speech/speak", () => ({ cancelSpeech: vi.fn(), speechSupported: () => true }));
vi.mock("../speech/gemini", () => ({ teacher: teacherMock, setFallbackVoice: vi.fn() }));
vi.mock("../lib/api", () => ({
  api: {
    workoutCoach: vi.fn(
      () =>
        new Promise((resolve) => {
          coach.resolve = resolve;
        }),
    ),
  },
}));

import WorkoutSession from "./WorkoutSession";

const exercises = [
  { id: "squat", name: "スクワット", sets: 2, reps: "10回", restSec: 30, cue: "背筋を伸ばす" },
  { id: "plank", name: "プランク", sets: 2, reps: "20秒", restSec: 30, cue: "お腹に力" },
];
const settings = {
  voiceEnabled: true,
  geminiVoiceEnabled: true,
  musicEnabled: false,
  ai: { coach: { provider: "x" } },
} as never;

const mount = (onClose = vi.fn()) =>
  render(
    <WorkoutSession
      exercises={exercises}
      title="Day 1"
      settings={settings}
      shape={"average" as never}
      weight={undefined}
      onClose={onClose}
    />,
  );

const closingSays = () =>
  teacherMock.say.mock.calls.filter(([c]) => (c as { phase: string }).phase === "closing");

/** One-set session carried to the done screen with the coach still pending. */
async function finishOneSet() {
  const view = mount();
  fireEvent.click(screen.getByText("まず1セットだけやる"));
  fireEvent.click(await screen.findByText("できた"));
  await waitFor(() => expect(screen.getByText(/この調子で続ける/)).toBeTruthy());
  await waitFor(() => expect(coach.resolve).toBeTypeOf("function"));
  return view;
}
const answer = async () => {
  await act(async () => {
    coach.resolve!({ closing: { message: "おつかれ。", next: "また明日。" } });
    await new Promise((r) => setTimeout(r, 0));
  });
};

beforeEach(() => {
  calls.length = 0;
  prefetches.length = 0;
  coach.resolve = undefined;
  teacherMock.say.mockImplementation((c: { text: string }) => {
    calls.push(`say:${c.text}`);
    return { cancel: vi.fn() };
  });
  teacherMock.interrupt.mockImplementation(() => void calls.push("interrupt"));
  teacherMock.prefetch.mockImplementation(async (p: { text: string; phase: string }[]) => {
    prefetches.push(p);
    return { cached: 0, failed: 0 };
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("scene changes", () => {
  it("keeps the first start cue and cuts stale speech before the rest and next-set cues", async () => {
    mount();
    fireEvent.click(screen.getByText("はじめる"));
    await screen.findByText("できた");
    expect(calls[0]).toMatch(/^say:/);
    expect(calls.filter((c) => c === "interrupt")).toHaveLength(0);

    calls.length = 0;
    fireEvent.click(screen.getByText("できた"));
    await screen.findByText("休憩");
    expect(calls.indexOf("interrupt")).toBeGreaterThanOrEqual(0);
    const restAt = calls.findIndex((c) => c.startsWith("say:"));
    expect(calls.indexOf("interrupt")).toBeLessThan(restAt);

    calls.length = 0;
    fireEvent.click(screen.getByText("次へ"));
    await screen.findByText("できた");
    const cut = calls.indexOf("interrupt");
    const start = calls.findIndex((c) => c.startsWith("say:"));
    expect(cut).toBeGreaterThanOrEqual(0);
    expect(start).toBeGreaterThan(cut);
  });
});

describe("closing words", () => {
  it("speaks when the answer arrives in time", async () => {
    await finishOneSet();
    await answer();
    await waitFor(() => expect(closingSays()).toHaveLength(1));
  });

  it("does not speak after the user stops and leaves", async () => {
    const view = await finishOneSet();
    fireEvent.click(screen.getByText("戻る"));
    await answer();
    expect(closingSays()).toHaveLength(0);
    view.unmount();
  });

  it("does not speak after navigating away", async () => {
    const view = await finishOneSet();
    view.unmount();
    await answer();
    expect(closingSays()).toHaveLength(0);
  });

  it("does not speak or show a stale answer after continuing the workout", async () => {
    await finishOneSet();
    fireEvent.click(screen.getByText(/この調子で続ける/));
    await answer();
    expect(closingSays()).toHaveLength(0);
    expect(screen.queryByText("おつかれ。")).toBeNull();
  });
});

describe("prefetch", () => {
  it("does not prefetch speculatively while the check-in is being changed", async () => {
    mount();
    fireEvent.click(screen.getByText("10分"));
    fireEvent.click(screen.getByText("元気"));
    await new Promise((r) => setTimeout(r, 1200));
    expect(teacherMock.prefetch).not.toHaveBeenCalled();
  });

  it("prefetches the chosen plan once, within the line budget", async () => {
    mount();
    fireEvent.click(screen.getByText("はじめる"));
    await screen.findByText("できた");
    const sessionCalls = prefetches.filter((p) => p.some((x) => x.phase !== "closing"));
    expect(sessionCalls).toHaveLength(1);
    expect(sessionCalls[0]!.length).toBeLessThanOrEqual(48);
  });
});
