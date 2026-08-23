// The signature element: a steelyard beam.
//
// A traditional Japanese sao-bakari is a horizontal rod with graduations
// and a sliding weight. Here the rod spans the journey — starting weight
// at the left, goal at the right — and the needle marks today's reading.
// Progress is therefore a distance you can see, not a percentage you have
// to interpret, and gaining weight visibly pushes the needle backwards.

import { useEffect, useState } from "react";

type Props = {
  startKg: number;
  currentKg: number;
  targetKg: number;
  /** Where the current trend lands. Drawn as a ghost tick. */
  projectedKg?: number;
  /** Tiny caption printed above the needle reading — e.g. "TREND" to
   *  mark that `currentKg` is a smoothed value, not this morning's raw
   *  entry. Omit for callers (the sign-in preview) that pass a plain
   *  number with no averaging behind it. */
  currentLabel?: string;
  /** Full explanation behind `currentLabel`, exposed as a native tooltip
   *  on the needle group and folded into the SVG's aria-label. Anyone who
   *  already knows never needs to trigger it; the tiny caption is the
   *  only thing they see. */
  currentHint?: string;
};

const WIDTH = 320;
const HEIGHT = 96;
const PAD_X = 18;
const BEAM_Y = 58;

export default function BeamScale({
  startKg,
  currentKg,
  targetKg,
  projectedKg,
  currentLabel,
  currentHint,
}: Props) {
  // The needle swings in from the start mark on first paint, so opening
  // the app replays the progress made so far.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const heaviest = Math.max(startKg, currentKg, targetKg);
  const lightest = Math.min(startKg, currentKg, targetKg);
  const span = Math.max(2, heaviest - lightest);
  const pad = span * 0.12;
  const hi = heaviest + pad;
  const lo = lightest - pad;

  // Heavier on the left, lighter on the right: losing weight travels
  // rightward, which reads as forward motion.
  const x = (kg: number) =>
    PAD_X + ((hi - kg) / (hi - lo)) * (WIDTH - PAD_X * 2);

  const step = span > 24 ? 5 : span > 10 ? 2 : 1;
  const firstTick = Math.ceil(lo / step) * step;
  const ticks: number[] = [];
  for (let v = firstTick; v <= hi; v += step) ticks.push(v);

  const needleX = settled ? x(currentKg) : x(startKg);
  const done = currentKg <= targetKg;

  // The needle carries its reading above the beam, at the same height as
  // the post labels. On day one it stands exactly on START, and on the last
  // day exactly on GOAL, so a label within reach of the reading would be
  // printed straight through it — and on the way out the reading sweeps
  // across START regardless. Measure against where the needle actually is
  // and fade the label out while it is in the way; the post still marks
  // the spot, and the reading says what the number is.
  const labelOpacity = (kg: number) =>
    Math.abs(x(kg) - needleX) > 46 ? 1 : 0;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full"
      role="img"
      aria-label={`開始 ${startKg.toFixed(1)}kg、現在 ${currentKg.toFixed(1)}kg、目標 ${targetKg.toFixed(1)}kg${currentHint ? `。${currentHint}` : ""}`}
    >
      {/* Travelled portion of the beam */}
      <line
        x1={x(startKg)}
        y1={BEAM_Y}
        x2={needleX}
        y2={BEAM_Y}
        stroke="var(--needle)"
        strokeWidth={3}
        strokeLinecap="round"
        style={{ transition: "all 900ms cubic-bezier(0.22, 1, 0.36, 1)" }}
      />
      {/* Remaining portion */}
      <line
        x1={needleX}
        y1={BEAM_Y}
        x2={x(targetKg)}
        y2={BEAM_Y}
        stroke="var(--rule-strong)"
        strokeWidth={3}
        strokeLinecap="round"
        style={{ transition: "all 900ms cubic-bezier(0.22, 1, 0.36, 1)" }}
      />

      {/* Graduations */}
      {ticks.map((v) => {
        const major = Math.abs(v % (step * 5)) < 1e-6;
        return (
          <g key={v}>
            <line
              x1={x(v)}
              y1={BEAM_Y + 5}
              x2={x(v)}
              y2={BEAM_Y + (major ? 13 : 9)}
              stroke="var(--rule-strong)"
              strokeWidth={1}
            />
            {major && (
              <text
                x={x(v)}
                y={BEAM_Y + 26}
                textAnchor="middle"
                className="reading"
                fontSize={9}
                fill="var(--muted)"
              >
                {v}
              </text>
            )}
          </g>
        );
      })}

      {/* Start post — without it the travelled segment appears to begin
          nowhere, and the distance already covered is the encouraging half
          of this picture. */}
      <g>
        <line
          x1={x(startKg)}
          y1={BEAM_Y - 10}
          x2={x(startKg)}
          y2={BEAM_Y + 10}
          stroke="var(--rule-strong)"
          strokeWidth={1.5}
        />
        <text
          x={x(startKg)}
          y={BEAM_Y - 15}
          textAnchor="middle"
          className="engraved"
          fontSize={7.5}
          fill="var(--muted)"
          letterSpacing="0.1em"
          opacity={labelOpacity(startKg)}
          style={{ transition: "opacity 400ms ease 500ms" }}
        >
          START
        </text>
      </g>

      {/* Goal post */}
      <g>
        <line
          x1={x(targetKg)}
          y1={BEAM_Y - 14}
          x2={x(targetKg)}
          y2={BEAM_Y + 14}
          stroke="var(--goal)"
          strokeWidth={2}
          strokeDasharray="3 3"
        />
        <text
          x={x(targetKg)}
          y={BEAM_Y - 20}
          textAnchor="middle"
          className="engraved"
          fontSize={8}
          fill="var(--goal)"
          letterSpacing="0.1em"
          opacity={labelOpacity(targetKg)}
          style={{ transition: "opacity 400ms ease" }}
        >
          GOAL
        </text>
      </g>

      {/* Where the current trend lands */}
      {projectedKg !== undefined && (
        <line
          x1={x(projectedKg)}
          y1={BEAM_Y - 9}
          x2={x(projectedKg)}
          y2={BEAM_Y + 9}
          stroke="var(--muted)"
          strokeWidth={1.5}
          opacity={0.7}
        />
      )}

      {/* The needle */}
      <g
        style={{
          transform: `translateX(${needleX}px)`,
          transition: "transform 900ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {currentHint && <title>{currentHint}</title>}
        <path
          d="M 0 -6 L -5 -16 L 5 -16 Z"
          transform={`translate(0 ${BEAM_Y})`}
          fill={done ? "var(--goal)" : "var(--needle)"}
        />
        <line
          x1={0}
          y1={BEAM_Y - 6}
          x2={0}
          y2={BEAM_Y + 6}
          stroke={done ? "var(--goal)" : "var(--needle)"}
          strokeWidth={2.5}
        />
        {currentLabel && (
          <text
            x={0}
            y={BEAM_Y - 34}
            textAnchor="middle"
            fontSize={6.5}
            fontWeight={600}
            letterSpacing="0.08em"
            fill="var(--muted)"
            opacity={0.65}
            style={{ fontFamily: '"Archivo", "Segoe UI", system-ui, sans-serif' }}
          >
            {currentLabel}
          </text>
        )}
        <text
          x={0}
          y={BEAM_Y - 22}
          textAnchor="middle"
          className="reading"
          fontSize={15}
          fontWeight={700}
          fill={done ? "var(--goal)" : "var(--needle)"}
        >
          {currentKg.toFixed(1)}
        </text>
      </g>
    </svg>
  );
}
