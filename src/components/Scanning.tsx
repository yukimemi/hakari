// What a long wait should look like.
//
// The AI calls here take anywhere from ten seconds to two minutes, and a
// spinner says nothing about which of those you are in for. Three things
// fix that without pretending to know a percentage:
//
//   1. A line that sweeps the picture, so the machine is visibly reading
//      the thing you handed it rather than thinking in the abstract.
//   2. The step it is on, in order. The steps are honest — they are the
//      order the prompt actually asks for — but their timing is not
//      measured, so they advance on a timer and hold on the last one.
//   3. Elapsed seconds. A wait you can see the length of is a wait you can
//      decide to keep waiting through.
//
// It also holds a screen wake lock. Not decoration: a phone that auto-locks
// mid-analysis freezes the page and the answer is lost. This component is
// mounted for exactly as long as a wait lasts, which is why the lock lives
// here rather than being re-derived from a busy flag at every call site.
//
// Kept in the instrument language: the sweep is the needle colour, and the
// edge carries graduations, so it reads as a measurement being taken.

import { useEffect, useState } from "react";
import { useWakeLock } from "../lib/wakeLock";

type Props = {
  /** The steps, in the order the work happens. The last one holds. */
  steps: string[];
  /** Seconds between steps. */
  everySec?: number;
  /** Over a photo, or standing on its own (no image to sweep). */
  variant?: "overlay" | "panel";
};

export default function Scanning({
  steps,
  everySec = 4,
  variant = "overlay",
}: Props) {
  useWakeLock();

  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const tick = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    if (step >= steps.length - 1) return;
    const next = window.setTimeout(
      () => setStep((s) => Math.min(s + 1, steps.length - 1)),
      everySec * 1000,
    );
    return () => window.clearTimeout(next);
  }, [step, steps.length, everySec]);

  const caption = (
    <div className="flex items-baseline justify-center gap-2">
      <span className="text-sm font-medium text-ink">{steps[step]}</span>
      <span className="reading text-xs tabular-nums text-muted">
        {elapsed}s
      </span>
    </div>
  );

  if (variant === "panel") {
    return (
      <div
        className="rounded-lg border border-rule/60 bg-sunk p-5"
        role="status"
        aria-live="polite"
      >
        <div className="scan-track mx-auto mb-4 h-0.5 w-full max-w-xs overflow-hidden rounded-full">
          <div className="scan-sweep-x h-full w-1/3 rounded-full" />
        </div>
        {caption}
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 flex flex-col justify-end"
      role="status"
      aria-live="polite"
    >
      {/* The sweep itself. `overflow-hidden` on the parent keeps it inside
          the photo, and the gradient gives the line a leading edge rather
          than a hard rule — it reads as a pass, not a divider. */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="scan-sweep-y absolute inset-x-0 h-1/3" />
      </div>

      <div className="relative bg-gradient-to-t from-panel/95 to-transparent px-3 pb-3 pt-8">
        {caption}
      </div>
    </div>
  );
}
