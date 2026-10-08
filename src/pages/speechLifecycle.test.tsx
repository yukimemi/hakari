// @vitest-environment jsdom
//
// Two small speech lifecycle rules outside the guided session:
//
//   - an exercise whose completion save failed is still on screen, so
//     leaving it must silence the teacher like any other mid-exercise exit,
//   - a Settings preview still waiting on its request must not talk after
//     the screen is gone.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const teacherMock = vi.hoisted(() => ({
  say: vi.fn(),
  stop: vi.fn(),
  pause: vi.fn(),
  unlock: vi.fn(async () => {}),
  setGeminiEnabled: vi.fn(),
  prefetch: vi.fn<(phrases: unknown[], signal?: AbortSignal) => Promise<{ cached: number; failed: number }>>(
    async () => ({ cached: 0, failed: 0 }),
  ),
}));

vi.mock("../speech/gemini", () => ({
  teacher: teacherMock,
  setFallbackVoice: vi.fn(),
  introLine: (e: { name: string }) => e.name,
  closingLine: (name: string) => `${name}、おわり`,
}));
vi.mock("../speech/speak", () => ({
  speak: vi.fn(() => ({ cancel: vi.fn() })),
  cancelSpeech: vi.fn(),
  speechSupported: () => true,
}));
vi.mock("../auth/context", () => ({
  useAuth: () => ({ user: null }),
  useUid: () => "u1",
}));
vi.mock("../data/clips", () => ({ useClips: () => ({}) }));
vi.mock("../avatar/AvatarStage", () => ({ default: () => null }));
vi.mock("../components/ClipStage", () => ({ default: () => null }));

import { Demonstration } from "./Training";
import { GeminiVoice } from "./Settings";

beforeEach(() => {
  teacherMock.say.mockReturnValue({ cancel: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const exercise = { id: "squat", name: "スクワット", sets: 2, reps: "10回", restSec: 30, cue: "背筋" };
const demo = (onComplete: () => Promise<void>) =>
  render(
    <Demonstration
      exercise={exercise}
      shape={"average" as never}
      avatarSrc=""
      voiceEnabled
      voicePitch={1}
      geminiVoice
      clipSubject=""
      weightKg={60}
      onClose={() => {}}
      onComplete={onComplete}
    />,
  );

describe("Demonstration", () => {
  it("lets the closing line finish when the save succeeds", async () => {
    const view = demo(async () => {});
    fireEvent.click(screen.getByText("この種目を完了にする"));
    await waitFor(() =>
      expect(teacherMock.say).toHaveBeenCalledWith(expect.objectContaining({ phase: "closing" })),
    );
    teacherMock.stop.mockClear();
    view.unmount();
    expect(teacherMock.stop).not.toHaveBeenCalled();
  });

  it("silences everything on leave after a failed save", async () => {
    const cancel = vi.fn();
    teacherMock.say.mockReturnValue({ cancel });
    const view = demo(async () => {
      throw new Error("offline");
    });
    fireEvent.click(screen.getByText("この種目を完了にする"));
    await waitFor(() => expect(cancel).toHaveBeenCalled());
    teacherMock.stop.mockClear();
    view.unmount();
    expect(teacherMock.stop).toHaveBeenCalled();
  });
});

describe("GeminiVoice preview", () => {
  it("does not speak when the screen is left while the request is pending", async () => {
    let release!: () => void;
    teacherMock.prefetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ cached: 1, failed: 0 });
        }),
    );
    const view = render(<GeminiVoice enabled pitch={1} onChange={() => {}} />);
    fireEvent.click(screen.getByText("Gemini で試しに聞く"));
    await waitFor(() => expect(teacherMock.prefetch).toHaveBeenCalled());
    const signal = (teacherMock.prefetch.mock.calls[0] as unknown as [unknown, AbortSignal])[1];
    view.unmount();
    expect(signal.aborted).toBe(true);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(teacherMock.say).not.toHaveBeenCalled();
  });

  it("speaks the preview when the screen stays", async () => {
    teacherMock.prefetch.mockResolvedValue({ cached: 1, failed: 0 });
    render(<GeminiVoice enabled pitch={1} onChange={() => {}} />);
    fireEvent.click(screen.getByText("Gemini で試しに聞く"));
    await waitFor(() => expect(teacherMock.say).toHaveBeenCalledTimes(1));
  });
});
