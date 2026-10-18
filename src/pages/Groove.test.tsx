// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../shared/schema";
import type { StoredGroove } from "../data/store";

const mocks = vi.hoisted(() => ({
  time: 0,
  playing: false,
  saveWorkout: vi.fn(async () => {}),
  deleteGroove: vi.fn(async () => {}),
  deleteSong: vi.fn(async () => {}),
  readGroove: vi.fn(),
  watchGrooves: vi.fn(),
  saveGroove: vi.fn(async () => {}),
  groovePlan: vi.fn(),
}));

vi.mock("../auth/context", () => ({ useUid: () => "test-user" }));
vi.mock("../avatar/AvatarStage", () => ({ default: () => null }));
vi.mock("../audio/mixer", () => ({ speakDucked: vi.fn() }));
vi.mock("../lib/api", () => ({ api: { groovePlan: mocks.groovePlan }, ApiError: class extends Error {} }));
vi.mock("../lib/wakeLock", () => ({ useWakeLock: vi.fn() }));
vi.mock("../speech/speak", () => ({ cancelSpeech: vi.fn(), speechSupported: () => false }));
vi.mock("../speech/gemini", () => ({
  setFallbackVoice: vi.fn(),
  teacher: {
    stop: vi.fn(), pause: vi.fn(), unlock: vi.fn(), setGeminiEnabled: vi.fn(),
    onSpeakingChange: () => () => {},
  },
}));
vi.mock("../data/store", () => ({
  saveWorkout: mocks.saveWorkout,
  deleteGroove: mocks.deleteGroove,
  readGroove: mocks.readGroove,
  watchGrooves: mocks.watchGrooves,
  saveGroove: mocks.saveGroove,
}));
vi.mock("../groove/library", () => ({
  getCharacter: async () => null,
  getSong: async () => ({ blob: { arrayBuffer: async () => new ArrayBuffer(0) } }),
  songId: async () => "new-song",
  putSong: vi.fn(),
  deleteSong: mocks.deleteSong,
  clearCharacter: vi.fn(),
  putCharacter: vi.fn(),
}));
vi.mock("../groove/player", () => ({
  GroovePlayer: class {
    duration = 120;
    get playing() { return mocks.playing; }
    time() { return mocks.time; }
    async load() { this.stop(); }
    play(from = mocks.time) { mocks.time = from; mocks.playing = true; }
    pause() { mocks.playing = false; }
    stop() { mocks.time = 0; mocks.playing = false; }
    dispose() { this.stop(); }
    setClicks() {}
    onEnded() {}
  },
}));

import Groove from "./Groove";

const song = (id: string, title: string): StoredGroove => ({
  id, title, durationSec: 120, source: "rule", picks: [],
  analysis: {
    bpm: 120, downbeat: 0, offsetSec: 0,
    beats: Array.from({ length: 240 }, (_, i) => i * 0.5),
    beatEnergy: Array(240).fill(0.5),
  },
});
const original = song("original", "元の曲");
const next = song("next", "次の曲");

beforeEach(() => {
  mocks.time = 0;
  mocks.playing = false;
  mocks.watchGrooves.mockImplementation((_uid, update) => {
    update([original, next]);
    return () => {};
  });
  mocks.readGroove.mockResolvedValue(next);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

async function begin(paused: boolean, seconds = 48) {
  const view = render(<Groove
    settings={{ ...DEFAULT_SETTINGS, voiceEnabled: false }}
    shape={{ shoulder: 0, chest: 0, waist: 0, hip: 0, thigh: 0, arm: 0 }}
    weight={{ kg: 60, source: "latest" }} onClose={() => {}}
  />);
  fireEvent.click(screen.getByRole("button", { name: /元の曲/ }));
  fireEvent.click(await screen.findByRole("button", { name: "スタート" }));
  mocks.time = seconds;
  if (paused) fireEvent.click(screen.getByRole("button", { name: "一時停止" }));
  return view;
}

describe("Groove outgoing run", () => {
  it.each(["file", "saved", "delete"])("records the original run before %s resets playback", async (action) => {
    const view = await begin(action !== "delete");
    if (action === "file") {
      const file = new File(["audio"], "next.wav", { type: "audio/wav" });
      Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(0) });
      fireEvent.change(view.container.querySelector('input[accept="audio/*"]')!, {
        target: { files: [file] },
      });
    } else if (action === "saved") {
      fireEvent.click(screen.getByRole("button", { name: /次の曲/ }));
    } else {
      fireEvent.click(screen.getAllByRole("button", { name: "削除" })[0]);
    }
    await waitFor(() => expect(mocks.saveWorkout).toHaveBeenCalledTimes(1));
    expect(mocks.saveWorkout).toHaveBeenCalledWith("test-user", expect.objectContaining({
      name: "曲に合わせて: 元の曲", minutes: 0.8, kcalBurned: expect.any(Number),
    }), expect.stringMatching(/^groove-/));
    await waitFor(() => expect(screen.queryByText("曲を読み込んでいます…")).toBeNull());
    expect(mocks.time).toBe(0);
    if (action === "delete") {
      expect(mocks.deleteGroove).toHaveBeenCalledWith("test-user", original.id);
      expect(mocks.deleteSong).toHaveBeenCalledWith(original.id);
    } else {
      // A new run and unmount must not re-save the outgoing run.
      fireEvent.click(screen.getByRole("button", { name: "スタート" }));
    }
    view.unmount();
    expect(mocks.saveWorkout).toHaveBeenCalledTimes(1);
  });

  it("keeps a short preview out of the workout log when switching songs", async () => {
    const view = await begin(true, 10);
    fireEvent.click(screen.getByRole("button", { name: /次の曲/ }));
    await screen.findByRole("button", { name: "スタート" });
    view.unmount();
    expect(mocks.saveWorkout).not.toHaveBeenCalled();
  });

  it("keeps one set of transport controls while the stage is expanded, and Escape collapses it", async () => {
    await begin(false);
    fireEvent.click(screen.getByRole("button", { name: "拡大" }));
    expect(screen.getAllByRole("button", { name: "一時停止" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "終了" })).toHaveLength(1);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "拡大" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "一時停止" })).toHaveLength(1);
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it.each([false, true])("does not recreate a deleted program with a pending nudge (switch song: %s)", async (switchSong) => {
    render(<Groove
      settings={{ ...DEFAULT_SETTINGS, voiceEnabled: false }}
      shape={{ shoulder: 0, chest: 0, waist: 0, hip: 0, thigh: 0, arm: 0 }}
      weight={{ kg: 60, source: "latest" }} onClose={() => {}}
    />);
    fireEvent.click(screen.getByRole("button", { name: /元の曲/ }));
    fireEvent.click(await screen.findByRole("button", { name: "+10ms" }));
    if (switchSong) {
      fireEvent.click(screen.getByRole("button", { name: /次の曲/ }));
      await waitFor(() => expect(screen.getByRole("button", { name: /次の曲/ }).hasAttribute("disabled")).toBe(false));
    }
    fireEvent.click(screen.getAllByRole("button", { name: "削除" })[0]);
    await waitFor(() => expect(mocks.deleteGroove).toHaveBeenCalledWith("test-user", original.id));
    // Past the 800 ms debounce.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(mocks.saveGroove).not.toHaveBeenCalled();
  });

  it.each([false, true])("discards choreography after deletion (request fails: %s)", async (fails) => {
    let resolve!: (value: { picks: []; note: string }) => void;
    let reject!: (reason: Error) => void;
    mocks.groovePlan.mockReturnValueOnce(new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    }));
    await begin(true);
    fireEvent.click(screen.getByRole("button", { name: "終了" }));
    fireEvent.click(screen.getByRole("button", { name: "AI で振り付け" }));
    expect(mocks.groovePlan).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole("button", { name: "削除" })[0]);
    await waitFor(() => expect(mocks.deleteGroove).toHaveBeenCalledWith("test-user", original.id));
    // Open another song before the stale request settles.
    fireEvent.click(screen.getByRole("button", { name: /次の曲/ }));
    await screen.findByRole("button", { name: "スタート" });
    await act(async () => {
      if (fails) reject(new Error("stale failure"));
      else resolve({ picks: [], note: "stale choreography" });
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "AI で振り付け" }).hasAttribute("disabled")).toBe(false));
    expect(mocks.saveGroove).not.toHaveBeenCalled();
    expect(screen.queryByText("stale choreography")).toBeNull();
    expect(screen.queryByText("振り付けを作れませんでした")).toBeNull();
    // The selected program must remain the second song.
    fireEvent.click(screen.getByRole("button", { name: "スタート" }));
    mocks.time = 48;
    fireEvent.click(screen.getByRole("button", { name: "終了" }));
    await waitFor(() => expect(mocks.saveWorkout).toHaveBeenLastCalledWith("test-user",
      expect.objectContaining({ name: "曲に合わせて: 次の曲" }), expect.any(String)));
  });
});
