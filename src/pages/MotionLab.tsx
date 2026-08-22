// Temporary authoring harness for the exercise motions. Not linked from
// anywhere; reachable at /dev/motions while working on procedural.ts.

import { useState } from "react";
import AvatarStage from "../avatar/AvatarStage";
import { EXERCISES } from "../../shared/exercises";
import { MOTIONS } from "../avatar/procedural";
import { useSettings } from "../data/hooks";
import { Panel, Select } from "../components/ui";

const NEUTRAL = {
  shoulder: 0,
  chest: 0,
  waist: 0,
  hip: 0,
  thigh: 0,
  arm: 0,
};

export default function MotionLab() {
  const { settings } = useSettings();
  const [id, setId] = useState(EXERCISES[0]!.id);
  const [bare, setBare] = useState(true);
  const [speed, setSpeed] = useState(1);

  return (
    <Panel title="motion lab">
      <div className="grid grid-cols-2 gap-2">
        <Select value={id} onChange={(e) => setId(e.target.value)}>
          {EXERCISES.map((exercise) => (
            <option key={exercise.id} value={exercise.id}>
              {MOTIONS[exercise.id] ? "" : "× "}
              {exercise.name} ({exercise.id})
            </option>
          ))}
        </Select>
        <Select
          value={bare ? "bare" : "vrm"}
          onChange={(e) => setBare(e.target.value === "bare")}
        >
          <option value="bare">素体</option>
          <option value="vrm">アバター</option>
        </Select>
      </div>

      <input
        type="range"
        min="0.1"
        max="2"
        step="0.1"
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value))}
        className="mt-3 w-full"
      />
      <p className="text-xs text-muted">
        {speed.toFixed(1)}× / {MOTIONS[id] ? "motion あり" : "IDLE にフォールバック"}
      </p>

      <div className="mt-3 h-96 w-full overflow-hidden rounded-lg bg-sunk">
        <AvatarStage
          src={settings.avatarSrc}
          bare={bare}
          shape={NEUTRAL}
          exerciseId={id}
          speed={speed}
          className="h-full w-full"
        />
      </div>
    </Panel>
  );
}
