// @vitest-environment jsdom
//
// The failure this hook exists to prevent — a phone locking mid-analysis —
// cannot be reproduced in a test runner, so what is pinned down here is the
// lifecycle that makes the lock correct rather than the locking itself:
//
//   - held for the length of the wait, and handed back the moment it ends
//     (a lock left behind pins the screen awake for the rest of the
//     session, which is a battery leak the user would blame on the app),
//   - taken again after the browser drops it on hide, which it always does
//     and never undoes — without that, the first glance at another app
//     silently ends the protection for the rest of the wait,
//   - never held when there is nothing to wait for, and never fatal on a
//     browser that refuses or lacks the API.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useWakeLock } from "./wakeLock";

class FakeSentinel extends EventTarget {
  released = false;

  async release(): Promise<void> {
    this.released = true;
    this.dispatchEvent(new Event("release"));
  }
}

let granted: FakeSentinel[];
/** Held open to test what happens when a lock arrives too late. */
let gate: Promise<void>;
let openGate: () => void;
let refuse: boolean;

function installWakeLock(): void {
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: {
      request: async (type: string) => {
        expect(type).toBe("screen");
        await gate;
        if (refuse) throw new Error("refused");
        const sentinel = new FakeSentinel();
        granted.push(sentinel);
        return sentinel;
      },
    },
  });
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
}

function goVisible(state: DocumentVisibilityState): void {
  setVisibility(state);
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/** Lets the hook's pending promises settle inside React's act(). */
const flush = () => act(async () => {});

function Probe({ active }: { active: boolean }) {
  useWakeLock(active);
  return null;
}

beforeEach(() => {
  granted = [];
  gate = Promise.resolve();
  openGate = () => {};
  refuse = false;
  setVisibility("visible");
  installWakeLock();
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator as unknown as object, "wakeLock");
});

describe("useWakeLock", () => {
  it("holds the screen for the wait and gives it back at the end", async () => {
    const view = render(<Probe active />);
    await flush();

    expect(granted).toHaveLength(1);
    expect(granted[0]!.released).toBe(false);

    view.unmount();
    await flush();

    expect(granted[0]!.released).toBe(true);
  });

  it("asks for nothing when there is no wait", async () => {
    render(<Probe active={false} />);
    await flush();

    expect(granted).toHaveLength(0);
  });

  it("takes the lock again after the browser drops it on hide", async () => {
    render(<Probe active />);
    await flush();

    // What the browser itself does when the page goes away.
    setVisibility("hidden");
    await act(async () => {
      await granted[0]!.release();
    });
    goVisible("hidden");
    await flush();

    // Still hidden: asking now would only be refused.
    expect(granted).toHaveLength(1);

    goVisible("visible");
    await flush();

    expect(granted).toHaveLength(2);
    expect(granted[1]!.released).toBe(false);
  });

  it("does not stack requests when the page flickers mid-grant", async () => {
    gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });

    const view = render(<Probe active />);
    // A hide/show flicker while the first request is still in flight. The
    // held sentinel is still null at this point, so a guard that only looks
    // at it lets a second request through — and the loser of that race is
    // never released, pinning the screen awake past unmount.
    goVisible("hidden");
    goVisible("visible");
    openGate();
    await flush();

    expect(granted).toHaveLength(1);

    view.unmount();
    await flush();

    expect(granted.every((s) => s.released)).toBe(true);
  });

  it("releases a lock granted after the wait already finished", async () => {
    gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });

    const view = render(<Probe active />);
    view.unmount();
    openGate();
    await flush();

    expect(granted).toHaveLength(1);
    expect(granted[0]!.released).toBe(true);
  });

  it("carries on when the platform refuses", async () => {
    refuse = true;

    const view = render(<Probe active />);
    await flush();

    expect(granted).toHaveLength(0);
    expect(() => view.unmount()).not.toThrow();
  });

  it("carries on when the browser has no wake lock at all", async () => {
    Reflect.deleteProperty(navigator as unknown as object, "wakeLock");

    const view = render(<Probe active />);
    await flush();

    expect(() => view.unmount()).not.toThrow();
  });
});
