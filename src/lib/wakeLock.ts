// Keeping the screen on while the AI is working.
//
// The analysis calls run for anywhere from ten seconds to two minutes.
// A phone that auto-locks in the middle of one loses the answer: the page
// is frozen the moment it goes hidden, the in-flight fetch never gets its
// response handled, and the user unlocks to a spinner that will now spin
// forever. The wait is long *because* the model is slow, so "just be
// quicker" is not available — holding a screen wake lock for exactly as
// long as the wait lasts is.
//
// Two things the API forces on the caller, both handled here:
//
//   1. The browser releases the lock whenever the document becomes hidden
//      and does NOT hand it back on return, so it has to be re-acquired on
//      `visibilitychange`. (Little help against a lock that already
//      happened, but it restores protection for the rest of the wait.)
//   2. `request()` rejects rather than resolving to null when the platform
//      refuses — Low Power Mode, a browser without the API, a tab that
//      lost focus mid-call. None of that is worth an error the user can do
//      nothing about, so it fails silent and the wait behaves as it did
//      before.
//
// This cannot defeat the power button. It only stops the *idle* timer,
// which is the one that fires mid-analysis.

import { useEffect } from "react";

/**
 * Holds a screen wake lock for as long as `active` is true and the
 * component stays mounted. Safe to call unconditionally.
 */
export function useWakeLock(active = true): void {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    // Set by cleanup. Guards the gap between asking for a lock and being
    // handed one, which is long enough for a fast wait to have finished.
    let done = false;
    // `sentinel` is still null while a request is in flight, so a hide/show
    // flicker in that window would start a second one. Whichever settled
    // last would take the handle and the other would be held with nobody
    // left to release it — the screen stays awake past the wait.
    let pending = false;

    const acquire = async () => {
      if (done || sentinel || pending || document.visibilityState !== "visible") {
        return;
      }
      pending = true;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (done) {
          void next.release().catch(() => {});
          return;
        }
        sentinel = next;
        // The browser drops it on its own when the page hides; keep our
        // handle honest so the next acquire is not skipped as redundant.
        next.addEventListener("release", () => {
          if (sentinel === next) sentinel = null;
        });
      } catch {
        // Unsupported, refused, or no longer visible. Not actionable.
      } finally {
        pending = false;
      }
    };

    void acquire();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      done = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      const held = sentinel;
      sentinel = null;
      void held?.release().catch(() => {});
    };
  }, [active]);
}
