// "曲に合わせて": a workout laid over a song the user picked.
//
// Pick a song -> its beat is found in the browser -> one exercise per
// eight-bar section (rule-based at once, or by the model on request) ->
// play: the song is the clock, and the avatar's every rep starts on a beat.
//
// What goes where: the song stays on this device (IndexedDB, see
// `groove/library.ts`); the program — beat grid, picks — goes to Firestore
// under the song's SHA-256, so the same file re-opens the same program on
// any device. Nothing renders a video file: the program replays live.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUid } from "../auth/context";
import AvatarStage from "../avatar/AvatarStage";
import { speakDucked } from "../audio/mixer";
import { Alert, Button, Empty, Panel, Reading } from "../components/ui";
import {
  deleteGroove,
  readGroove,
  saveGroove,
  saveWorkout,
  watchGrooves,
  type StoredGroove,
} from "../data/store";
import { analyseFile, BEATS_PER_BAR, BeatError } from "../groove/beats";
import {
  activeSeconds,
  buildProgram,
  buildSections,
  beatAt,
  cuesFor,
  poseAt,
  rulePicks,
  type GrooveCue,
  type PickOptions,
} from "../groove/choreo";
import {
  clearCharacter,
  deleteSong,
  getCharacter,
  getSong,
  putCharacter,
  putSong,
  songId,
} from "../groove/library";
import { GroovePlayer } from "../groove/player";
import { api, ApiError } from "../lib/api";
import { formatKcal } from "../lib/format";
import { useWakeLock } from "../lib/wakeLock";
import { setFallbackVoice, teacher } from "../speech/gemini";
import { cancelSpeech, speechSupported } from "../speech/speak";
import { persistSession, type WeightSource } from "../workout/record";
import { sessionKcal, todayKey } from "../../shared/calc";
import { EXERCISE_BY_ID } from "../../shared/exercises";
import type { GrooveDoc, GrooveLevel } from "../../shared/groove";
import type { BodyShape, Settings, WorkoutEntry } from "../../shared/schema";

const NEUTRAL: BodyShape = { shoulder: 0, chest: 0, waist: 0, hip: 0, thigh: 0, arm: 0 };

const LEVEL_LABEL: Record<GrooveLevel, string> = { low: "軽め", mid: "普通", high: "強め" };

/** A cue this late is dropped rather than said: "3" a second after the
 *  change is worse than silence. */
const CUE_GRACE_SEC = 0.6;

type Loaded = { id: string; doc: GrooveDoc };

type Phase = "idle" | "playing" | "paused" | "done";

type Saved =
  | { kind: "none" }
  | { kind: "saving" }
  | { kind: "saved"; kcal: number; basis: string }
  | { kind: "failed"; message: string };

function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function Groove({
  settings,
  shape,
  weight,
  focusAreas,
  onClose,
}: {
  settings: Settings;
  shape: BodyShape;
  weight: WeightSource;
  focusAreas?: string[];
  onClose: () => void;
}) {
  const uid = useUid();
  const [player] = useState(() => new GroovePlayer());
  const [library, setLibrary] = useState<StoredGroove[]>([]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  /** A saved program whose song is not on this device yet. */
  const [needsFile, setNeedsFile] = useState<StoredGroove | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [segmentIndex, setSegmentIndex] = useState(-1);
  const [now, setNow] = useState(0);
  const [clicks, setClicks] = useState(false);
  const [saved, setSaved] = useState<Saved>({ kind: "none" });
  const [character, setCharacter] = useState<{ name: string; url: string } | null>(null);

  const songInput = useRef<HTMLInputElement>(null);
  const characterInput = useRef<HTMLInputElement>(null);

  const opts: PickOptions = settings.training;
  const voiceOk = settings.voiceEnabled && speechSupported();
  const geminiOn = voiceOk && settings.geminiVoiceEnabled;
  useWakeLock(phase === "playing");

  // --- library and character --------------------------------------------

  useEffect(
    () => watchGrooves(uid, setLibrary, (err) => setError(err.message)),
    [uid],
  );

  useEffect(() => {
    let url: string | null = null;
    let live = true;
    void getCharacter()
      .then((stored) => {
        if (!stored || !live) return;
        url = URL.createObjectURL(stored.blob);
        setCharacter({ name: stored.name, url });
      })
      .catch(() => {});
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  const pickCharacter = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".vrm")) {
      setError(".vrm ファイルを選んでください");
      return;
    }
    await putCharacter(file, file.name);
    if (character) URL.revokeObjectURL(character.url);
    setCharacter({ name: file.name, url: URL.createObjectURL(file) });
  };

  const resetCharacter = async () => {
    await clearCharacter();
    if (character) URL.revokeObjectURL(character.url);
    setCharacter(null);
  };

  // --- the program -------------------------------------------------------

  const sections = useMemo(() => (loaded ? buildSections(loaded.doc.analysis) : []), [loaded]);
  const picks = useMemo(
    () => (loaded ? rulePicks(sections, opts, loaded.doc.picks) : []),
    [loaded, sections, opts],
  );
  const program = useMemo(
    () => (loaded ? buildProgram(loaded.doc.analysis, sections, picks, loaded.doc.durationSec) : null),
    [loaded, sections, picks],
  );
  const cues = useMemo(() => (program ? cuesFor(program) : []), [program]);

  const programRef = useRef(program);
  useEffect(() => {
    programRef.current = program;
  }, [program]);

  // A stable callback for the 3D stage, read once per frame.
  const timeline = useCallback(() => {
    const current = programRef.current;
    // Not gated on `playing`: paused, `time()` holds the position, so the
    // figure freezes mid-rep instead of dropping to idle; stopped it is 0,
    // before the first section, which is idle anyway.
    if (!current) return { phase: 0 };
    return poseAt(current, player.time());
  }, [player]);

  /** Writes the program back, at most once per burst of nudges. One timer
   *  per song: switching songs mid-burst must not drop the other's write. */
  const pendingSaves = useRef(new Map<string, number>());
  const cancelPendingSave = useCallback((id: string) => {
    const timer = pendingSaves.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    pendingSaves.current.delete(id);
  }, []);
  const choreographyRequest = useRef<{ id: string } | null>(null);
  const update = useCallback(
    (next: Loaded) => {
      setLoaded(next);
      cancelPendingSave(next.id);
      const timer = window.setTimeout(() => {
        pendingSaves.current.delete(next.id);
        void saveGroove(uid, next.id, next.doc).catch((err: unknown) =>
          setError(err instanceof Error ? err.message : "保存に失敗しました"),
        );
      }, 800);
      pendingSaves.current.set(next.id, timer);
    },
    [uid, cancelPendingSave],
  );

  // --- loading a song ----------------------------------------------------

  const openFile = async (file: File) => {
    setError(null);
    stopPlayback();
    setSaved({ kind: "none" });
    setBusy("曲を読み込んでいます");
    try {
      const id = await songId(file);
      if (needsFile && needsFile.id !== id) {
        setError("選んだファイルは、このプログラムの曲とは別のものです");
        return;
      }
      await putSong(id, file, file.name);
      const data = await file.arrayBuffer();
      let doc = await readGroove(uid, id);
      if (!doc) {
        setBusy("拍を検出しています");
        // decodeAudioData detaches what it is given, so each decode gets
        // its own copy.
        const found = await analyseFile(data.slice(0));
        const analysis = {
          bpm: found.bpm,
          beats: found.beats,
          downbeat: found.downbeat,
          beatEnergy: found.beatEnergy,
          offsetSec: 0,
        };
        doc = {
          title: file.name.replace(/\.[^.]+$/, "").slice(0, 200),
          durationSec: found.durationSec,
          analysis,
          picks: rulePicks(buildSections({ ...analysis }), opts),
          source: "rule",
        };
        await saveGroove(uid, id, doc);
      }
      await player.load(data);
      setNeedsFile(null);
      setLoaded({ id, doc });
    } catch (err) {
      setError(
        err instanceof BeatError
          ? err.message
          : err instanceof Error && err.name === "EncodingError"
            ? "この形式の音声は読み込めませんでした"
            : err instanceof Error
              ? err.message
              : "曲を読み込めませんでした",
      );
    } finally {
      setBusy(null);
    }
  };

  const openSaved = async (item: StoredGroove) => {
    setError(null);
    stopPlayback();
    setSaved({ kind: "none" });
    setBusy("曲を読み込んでいます");
    try {
      const song = await getSong(item.id);
      if (!song) {
        setLoaded(null);
        setNeedsFile(item);
        return;
      }
      await player.load(await song.blob.arrayBuffer());
      setNeedsFile(null);
      setLoaded({ id: item.id, doc: item });
    } catch (err) {
      setError(err instanceof Error ? err.message : "曲を読み込めませんでした");
    } finally {
      setBusy(null);
    }
  };

  const removeSaved = async (item: StoredGroove) => {
    if (!window.confirm(`「${item.title}」のプログラムを削除しますか?`)) return;
    // Invalidate work by its target, even when another song is selected.
    cancelPendingSave(item.id);
    if (choreographyRequest.current?.id === item.id) {
      choreographyRequest.current = null;
      setBusy(null);
    }
    if (loaded?.id === item.id) {
      stopPlayback();
      setLoaded(null);
    }
    await Promise.all([deleteGroove(uid, item.id), deleteSong(item.id)]);
  };

  // --- choreography by the model ----------------------------------------

  const choreograph = async () => {
    if (!loaded) return;
    const request = { id: loaded.id };
    choreographyRequest.current = request;
    setError(null);
    setBusy("AI が振り付けを考えています");
    try {
      const res = await api.groovePlan({
        assignment: settings.ai.plan,
        bpm: loaded.doc.analysis.bpm,
        durationSec: loaded.doc.durationSec,
        sections: sections.map(({ index, startSec, endSec, level, role }) => ({
          index,
          startSec: Math.round(startSec * 10) / 10,
          endSec: Math.round(endSec * 10) / 10,
          level,
          role,
        })),
        equipment: settings.training.equipment,
        experience: settings.training.experience,
        constraints: settings.training.constraints || undefined,
        focusAreas,
      });
      if (choreographyRequest.current !== request) return;
      const given = res.picks.map((p) => p ?? undefined);
      const doc: GrooveDoc = {
        ...loaded.doc,
        picks: rulePicks(sections, opts, given),
        source: "ai",
        note: res.note || undefined,
      };
      // The doc above already carries any nudge made before the request
      // (nudges are locked while it runs); a write still waiting would
      // land after this one and put the old picks back.
      cancelPendingSave(loaded.id);
      await saveGroove(uid, loaded.id, doc);
      if (choreographyRequest.current !== request) return;
      setLoaded({ id: loaded.id, doc });
    } catch (err) {
      if (choreographyRequest.current === request) {
        setError(err instanceof ApiError ? err.message : "振り付けを作れませんでした");
      }
    } finally {
      if (choreographyRequest.current === request) {
        choreographyRequest.current = null;
        setBusy(null);
      }
    }
  };

  // --- adjusting the grid -----------------------------------------------

  const nudge = (deltaSec: number) => {
    if (!loaded) return;
    const offsetSec =
      Math.round(Math.max(-2, Math.min(2, loaded.doc.analysis.offsetSec + deltaSec)) * 1000) / 1000;
    update({
      id: loaded.id,
      doc: { ...loaded.doc, analysis: { ...loaded.doc.analysis, offsetSec } },
    });
  };

  const shiftBar = () => {
    if (!loaded) return;
    const analysis = {
      ...loaded.doc.analysis,
      downbeat: (loaded.doc.analysis.downbeat + 1) % BEATS_PER_BAR,
    };
    // Sections move with the bar line, so the picks are re-fitted to them:
    // still-usable ones stay by position, the rest are chosen again.
    update({
      id: loaded.id,
      doc: { ...loaded.doc, analysis, picks: rulePicks(buildSections(analysis), opts, loaded.doc.picks) },
    });
  };

  useEffect(() => {
    player.setClicks(clicks && program ? program.grid : null, loaded?.doc.analysis.downbeat ?? 0);
  }, [player, clicks, program, loaded]);

  // --- voice -------------------------------------------------------------

  const say = useCallback(
    (cue: GrooveCue) => {
      if (!voiceOk) return;
      if (geminiOn) {
        setFallbackVoice({ voiceName: settings.voiceName, pitch: settings.voicePitch });
        teacher.say({ text: cue.text, phase: cue.phase, kind: cue.kind });
      } else {
        speakDucked(player, cue.text, { voiceName: settings.voiceName, pitch: settings.voicePitch });
      }
    },
    [player, voiceOk, geminiOn, settings.voiceName, settings.voicePitch],
  );

  useEffect(() => {
    teacher.setGeminiEnabled(geminiOn);
    return teacher.onSpeakingChange((on) => (on ? player.duck() : player.release()));
  }, [player, geminiOn]);

  // Every line of the program is known before it starts, so it is all
  // fetched ahead; none of it is personal, so it is cached for good.
  useEffect(() => {
    if (!geminiOn || !cues.length) return;
    const controller = new AbortController();
    const unique = new Map(cues.map((c) => [`${c.phase}\n${c.text}`, { text: c.text, phase: c.phase }]));
    void teacher.prefetch([...unique.values()], controller.signal);
    return () => controller.abort();
  }, [geminiOn, cues]);

  // --- the clock ---------------------------------------------------------

  const fired = useRef(new Set<string>());
  useEffect(() => {
    if (phase !== "playing" || !program) return;
    const id = window.setInterval(() => {
      const t = player.time();
      setNow(t);
      setSegmentIndex(poseAt(program, t).segment);
      for (const cue of cues) {
        if (cue.atSec > t) break;
        if (fired.current.has(cue.key)) continue;
        fired.current.add(cue.key);
        if (t - cue.atSec <= CUE_GRACE_SEC) say(cue);
      }
    }, 50);
    return () => window.clearInterval(id);
  }, [phase, program, cues, player, say]);

  // --- the record --------------------------------------------------------

  const runId = useRef<string | null>(null);
  const finish = useCallback(
    async (untilSec: number) => {
      const current = programRef.current;
      const id = runId.current;
      const title = loaded?.doc.title ?? "";
      if (!current || !id) return;
      runId.current = null;
      const rows = activeSeconds(current, untilSec);
      const estimate = sessionKcal({
        items: rows.map((r) => ({
          name: r.name,
          mets: EXERCISE_BY_ID.get(r.exerciseId)?.mets,
          activeSec: r.activeSec,
        })),
        weight,
      });
      const activeSec = rows.reduce((s, r) => s + r.activeSec, 0);
      // Under half a minute of moving is a song previewed, not a workout.
      if (activeSec < 30) return;
      const entry: WorkoutEntry = {
        date: todayKey(),
        name: `曲に合わせて: ${title}`.slice(0, 100),
        minutes: Math.round((activeSec / 60) * 10) / 10,
        kcalBurned: estimate.kcal ?? 0,
        kcalBasis: estimate.basis,
        kcalEstimated: estimate.kcal ?? undefined,
        note: rows.map((r) => r.name).join("・").slice(0, 500),
      };
      setSaved({ kind: "saving" });
      try {
        await persistSession((e, docId) => saveWorkout(uid, e, docId), entry, id);
        setSaved({ kind: "saved", kcal: entry.kcalBurned, basis: estimate.basis });
      } catch (err) {
        setSaved({ kind: "failed", message: err instanceof Error ? err.message : "保存に失敗しました" });
      }
    },
    [loaded, uid, weight],
  );

  const stopPlayback = useCallback(() => {
    // Capture the outgoing program and position before stopping resets the
    // clock or a song switch replaces the program. finish consumes runId
    // synchronously, so later stops/unmounts cannot record the run twice.
    void finish(player.time());
    player.stop();
    cancelSpeech();
    teacher.stop();
    setPhase("idle");
    setSegmentIndex(-1);
    setNow(0);
  }, [player, finish]);

  useEffect(() => {
    player.onEnded(() => {
      setPhase("done");
      setNow(player.duration);
      // The closing line sits at the song's last moment, which the polling
      // clock can miss by the time the source reports its end.
      const closing = cues.find((c) => c.kind === "closing");
      if (closing && !fired.current.has(closing.key)) {
        fired.current.add(closing.key);
        say(closing);
      }
      void finish(player.duration);
    });
    return () => player.onEnded(null);
  }, [player, finish, cues, say]);

  // Leaving mid-song keeps what was done.
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);
  useEffect(
    () => () => {
      void finishRef.current(player.time());
      cancelSpeech();
      teacher.stop();
      player.dispose();
    },
    [player],
  );

  // --- controls ----------------------------------------------------------

  const start = () => {
    // Inside the tap: what lets audio and speech start at all on iOS.
    void teacher.unlock();
    fired.current = new Set();
    runId.current = `groove-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    setSaved({ kind: "none" });
    player.play(0);
    setPhase("playing");
  };

  const pause = () => {
    player.pause();
    cancelSpeech();
    teacher.pause();
    setPhase("paused");
  };

  const resume = () => {
    void teacher.unlock();
    player.play();
    setPhase("playing");
  };

  const stop = () => {
    stopPlayback();
    setPhase("done");
  };

  // --- views -------------------------------------------------------------

  const segment = program && segmentIndex >= 0 ? program.segments[segmentIndex] : undefined;
  const next =
    program && segmentIndex < program.segments.length - 1
      ? program.segments[segmentIndex + 1]
      : undefined;
  const totalKcal = useMemo(() => {
    if (!program || !weight) return null;
    return sessionKcal({
      items: activeSeconds(program, program.durationSec).map((r) => ({
        name: r.name,
        mets: EXERCISE_BY_ID.get(r.exerciseId)?.mets,
        activeSec: r.activeSec,
      })),
      weight,
    }).kcal;
  }, [program, weight]);

  const caption =
    phase === "idle" || phase === "done"
      ? ""
      : segment
        ? `${segment.name} — ${EXERCISE_BY_ID.get(segment.exerciseId)?.cue ?? ""}`
        : next && segmentIndex < 0
          ? `まもなく ${next.name}`
          : "";

  return (
    <>
      <Panel
        title="曲に合わせて運動"
        action={
          <Button
            onClick={() => {
              stop();
              onClose();
            }}
            className="text-muted"
          >
            戻る
          </Button>
        }
      >
        <div className="relative h-72 w-full overflow-hidden rounded-lg bg-sunk">
          <AvatarStage
            src={character?.url ?? settings.avatarSrc}
            shape={character ? NEUTRAL : shape}
            timeline={timeline}
            className="h-full w-full"
          />
          {program && (phase === "playing" || phase === "paused") && (
            <BeatLight player={player} grid={program.grid} downbeat={loaded!.doc.analysis.downbeat} />
          )}
        </div>
        <p className="mt-3 min-h-[3rem] text-sm leading-relaxed" aria-live="polite">
          {caption}
        </p>
        {program && (
          <div className="mt-1">
            <div className="h-1.5 w-full overflow-hidden rounded bg-sunk">
              <div
                className="h-full bg-ink/70"
                style={{ width: `${Math.min(100, (now / program.durationSec) * 100)}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-xs text-muted">
              <span className="reading">{clock(now)}</span>
              <span>{next && phase === "playing" ? `次: ${next.name}` : ""}</span>
              <span className="reading">{clock(program.durationSec)}</span>
            </div>
          </div>
        )}
        {program && (
          <div className="mt-3 flex flex-wrap gap-2">
            {phase === "playing" ? (
              <Button variant="primary" size="lg" onClick={pause}>
                一時停止
              </Button>
            ) : phase === "paused" ? (
              <Button variant="primary" size="lg" onClick={resume}>
                再開
              </Button>
            ) : (
              <Button variant="primary" size="lg" onClick={start}>
                {phase === "done" ? "もう一度" : "スタート"}
              </Button>
            )}
            {(phase === "playing" || phase === "paused") && (
              <Button size="lg" onClick={stop}>
                終了
              </Button>
            )}
          </div>
        )}
        {!voiceOk && (
          <p className="mt-2 text-xs text-muted">音声は使えません (オフか非対応)。字幕で進めます。</p>
        )}
        {saved.kind === "saving" && <p className="mt-2 text-xs text-muted">記録しています…</p>}
        {saved.kind === "saved" && (
          <Alert tone="info">
            運動の記録に保存しました: 約 {formatKcal(saved.kcal)} kcal
            <span className="mt-1 block text-xs text-muted">{saved.basis}</span>
          </Alert>
        )}
        {saved.kind === "failed" && <Alert tone="error">記録を保存できませんでした: {saved.message}</Alert>}
      </Panel>

      {error && <Alert tone="error">{error}</Alert>}

      <Panel
        title="曲"
        action={
          <Button onClick={() => songInput.current?.click()} loading={busy !== null} disabled={phase === "playing"}>
            曲を選ぶ
          </Button>
        }
      >
        <input
          ref={songInput}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void openFile(file);
          }}
        />
        {busy && <p className="text-sm text-muted">{busy}…</p>}
        {needsFile && (
          <Alert tone="warn">
            「{needsFile.title}」の曲ファイルがこの端末にありません。同じファイルを選び直すと、保存したプログラムで再生できます。
          </Alert>
        )}
        {!loaded && !busy && !needsFile && (
          <p className="text-sm leading-relaxed">
            手元の曲ファイルを選ぶと、ブラウザの中で拍を検出して、曲の長さぴったりのプログラムを作ります。
            曲はこの端末から外に出ません。
          </p>
        )}
        {loaded && program && (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">{loaded.doc.title}</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Reading label="テンポ" value={String(loaded.doc.analysis.bpm)} unit="BPM" />
                <Reading label="長さ" value={clock(loaded.doc.durationSec)} />
                <Reading
                  label="消費の目安"
                  value={totalKcal === null ? "—" : formatKcal(totalKcal)}
                  unit={totalKcal === null ? undefined : "kcal"}
                />
              </div>
            </div>
            <ul className="divide-y divide-rule/60">
              {program.segments.map((s, i) => (
                <li
                  key={i}
                  className={`flex items-baseline justify-between gap-3 py-2 text-sm ${
                    i === segmentIndex ? "font-semibold" : ""
                  }`}
                >
                  <span className="reading w-24 shrink-0 text-xs text-muted">
                    {clock(s.startSec)}-{clock(s.endSec)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {LEVEL_LABEL[s.level]}・{s.beatsPerRep}拍で1回
                  </span>
                </li>
              ))}
            </ul>
            {loaded.doc.note && <p className="text-xs leading-relaxed text-muted">{loaded.doc.note}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={choreograph} loading={busy !== null} disabled={phase === "playing"}>
                {loaded.doc.source === "ai" ? "AI で組み直す" : "AI で振り付け"}
              </Button>
              <span className="text-xs text-muted">
                {loaded.doc.source === "ai" ? "AI が選んだ種目です" : "曲の盛り上がりから自動で選んだ種目です"}
              </span>
            </div>
          </div>
        )}
      </Panel>

      {loaded && (
        <Panel title="拍の合わせ込み">
          <p className="text-sm leading-relaxed">
            クリック音を鳴らして再生し、曲の拍とずれていたら調整します。調整は保存されます。
          </p>
          <label className="mt-3 flex items-center justify-between gap-3 text-sm">
            <span>クリック音</span>
            <input type="checkbox" checked={clicks} onChange={(e) => setClicks(e.target.checked)} />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* Locked while the model works: its answer is applied to the
                program as it was sent, and would undo a nudge made meanwhile. */}
            <Button onClick={() => nudge(-0.05)} disabled={busy !== null}>-50ms</Button>
            <Button onClick={() => nudge(-0.01)} disabled={busy !== null}>-10ms</Button>
            <span className="reading w-20 text-center text-sm">
              {Math.round(loaded.doc.analysis.offsetSec * 1000)}ms
            </span>
            <Button onClick={() => nudge(0.01)} disabled={busy !== null}>+10ms</Button>
            <Button onClick={() => nudge(0.05)} disabled={busy !== null}>+50ms</Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => nudge(30 / loaded.doc.analysis.bpm)} disabled={busy !== null}>
              裏拍にずれている時 (半拍)
            </Button>
            <Button onClick={shiftBar} disabled={phase === "playing" || busy !== null}>
              小節の頭を1拍ずらす
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted">
            プラスで拍が遅く、マイナスで早くなります。Bluetooth イヤホンではアバターが音より先に動いて見えることがあるので、その時はプラス方向に調整してください。
          </p>
        </Panel>
      )}

      <Panel
        title="キャラクター"
        action={<Button onClick={() => characterInput.current?.click()}>.vrm を選ぶ</Button>}
      >
        <input
          ref={characterInput}
          type="file"
          accept=".vrm"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void pickCharacter(file).catch(() => setError("キャラクターを保存できませんでした"));
          }}
        />
        {character ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{character.name}</span>
            <Button onClick={() => void resetCharacter()} className="text-muted">
              元に戻す
            </Button>
          </div>
        ) : (
          <p className="text-sm leading-relaxed">
            VRoid Studio などで作った .vrm を選ぶと、そのキャラクターが踊ります。ファイルはこの端末にだけ保存されます。
          </p>
        )}
      </Panel>

      <Panel title="保存したプログラム">
        {library.length === 0 ? (
          <Empty title="まだありません">曲を選ぶと、ここに保存されます。</Empty>
        ) : (
          <ul className="divide-y divide-rule/60">
            {library.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left hover:opacity-80"
                  onClick={() => void openSaved(item)}
                  disabled={busy !== null || phase === "playing"}
                >
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted">
                    {clock(item.durationSec)}・{item.analysis.bpm} BPM・{item.source === "ai" ? "AI" : "自動"}
                  </p>
                </button>
                <Button onClick={() => void removeSaved(item)} className="text-muted">
                  削除
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

/** A dot that flashes on every beat, brighter on the one. Driven by its own
 *  animation frame straight from the audio clock, not by React state. */
function BeatLight({
  player,
  grid,
  downbeat,
}: {
  player: GroovePlayer;
  grid: number[];
  downbeat: number;
}) {
  const dot = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const el = dot.current;
      if (el) {
        const t = player.time();
        const beat = beatAt(grid, t);
        const i = Math.floor(beat);
        const on = beat >= 0 && beat - i < 0.25;
        const bar = (((i - downbeat) % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
        el.style.opacity = on ? (bar === 0 ? "1" : "0.55") : "0.12";
        el.textContent = t >= grid[0]! ? String(bar + 1) : "";
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [player, grid, downbeat]);

  return (
    <span
      ref={dot}
      aria-hidden
      className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-needle text-[11px] font-semibold text-white transition-opacity duration-75"
    />
  );
}
