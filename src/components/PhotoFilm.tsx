// Body photos, played back as a flipbook.
//
// A strip of thumbnails shows that the photos exist; it does not show the
// change. Day to day the difference is below what anyone can see, and
// looking at two pictures side by side is not the same as watching one
// turn into the other. Played in place, at the same framing, the drift
// that no single photo carries becomes obvious.
//
// Two things make or break it:
//
//   Frames are stacked and switched by opacity, never by swapping `src`
//   on one <img>. A cached image still repaints white for a frame when
//   its src changes, and a white flash between two body photos reads as
//   a cut rather than a change.
//
//   Playback waits for frames rather than dropping them. Advancing past
//   an image that has not arrived silently skips a day, which is exactly
//   the day the viewer is looking for.

import { useEffect, useMemo, useRef, useState } from "react";
import { photoUrl, type BodyPhotoRecord } from "../data/store";
import { Alert, Button, Field, NumberInput, Panel, TextInput } from "./ui";
import { formatKg } from "../lib/format";
import { todayKey } from "../../shared/calc";

/** Milliseconds per frame. Slow enough to read the date at the top, fast
 *  enough that thirty days is not a sit-down. */
const SPEEDS = [
  { label: "ゆっくり", ms: 1400 },
  { label: "ふつう", ms: 700 },
  { label: "はやい", ms: 320 },
] as const;

/** How far ahead to fetch. Playback is forward, so the window is too —
 *  and at the fastest speed four frames is a second and a bit of lead. */
const LOOKAHEAD = 4;

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`);
  return Math.round(ms / 86_400_000);
}

export default function PhotoFilm({
  photos,
  onSave,
  onDelete,
}: {
  photos: BodyPhotoRecord[];
  onSave: (
    photo: BodyPhotoRecord,
    patch: { date: string; weightKg?: number },
  ) => Promise<void>;
  onDelete: (photo: BodyPhotoRecord) => Promise<void>;
}) {
  // The cursor is a photo, not a position. A corrected date reorders the
  // list and a deleted photo shortens it; an index would quietly come to
  // mean a different day in both cases, where an id that is no longer
  // there falls back to the same place `null` does.
  //
  // `null` means "the newest one", which is both the right thing to open
  // on and the right thing to do when a photo is added while this is
  // showing. Resolved on read, so there is never a render where the
  // cursor points past the end of a list that has just changed.
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [ready, setReady] = useState<Record<string, boolean>>({});
  // Null while not editing, seeded from the record on entry rather than
  // held in sync with it — the meal card's shape, so a half-typed
  // correction is not overwritten by the snapshot it came from.
  const [editing, setEditing] = useState<BodyPhotoRecord | null>(null);
  const [confirming, setConfirming] = useState(false);

  const found = cursorId === null ? -1 : photos.findIndex((p) => p.id === cursorId);
  const index = found === -1 ? photos.length - 1 : found;
  const seek = (to: number) => setCursorId(photos[to]?.id ?? null);

  // Storage URLs are signed and time-limited, so they are fetched per
  // view rather than stored alongside the record.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        photos.map(async (photo) => {
          try {
            return [photo.id, await photoUrl(photo.photoPath)] as const;
          } catch {
            // A photo that will not load is not worth an error here: the
            // rest of the film still plays.
            return null;
          }
        }),
      );
      if (!cancelled) setUrls(Object.fromEntries(entries.filter((e) => e !== null)));
    })();
    return () => {
      cancelled = true;
    };
  }, [photos]);

  // Only the window around the cursor gets a `src`, so a year of photos
  // does not sit decoded in memory on a phone. Everything outside it is
  // an empty <img> holding its place in the stack.
  const loadWindow = useMemo(() => {
    const from = Math.max(0, index - 1);
    const to = Math.min(photos.length - 1, index + LOOKAHEAD);
    return new Set(photos.slice(from, to + 1).map((photo) => photo.id));
  }, [photos, index]);

  const current = photos[index];
  const first = photos[0];
  const currentReady = current ? ready[current.id] : false;

  // Held in a ref as well so the interval can read it without being torn
  // down and rebuilt on every frame — restarting the timer each tick
  // makes the last frame of a slow load run long.
  const stateRef = useRef({ index, ready, count: photos.length });
  useEffect(() => {
    stateRef.current = { index, ready, count: photos.length };
  });

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const { index: at, ready: loaded, count: total } = stateRef.current;
      if (at >= total - 1) {
        setPlaying(false);
        return;
      }
      // Wait rather than skip. The frame that has not arrived is as much
      // a part of the change as the ones that have.
      if (!loaded[photos[at + 1]?.id ?? ""]) return;
      setCursorId(photos[at + 1].id);
    }, SPEEDS[speed].ms);
    return () => clearInterval(id);
  }, [playing, speed, photos]);

  const play = () => {
    // Starting from the end would show one frame and stop.
    if (index >= photos.length - 1) seek(0);
    setPlaying(true);
  };

  const remove = async () => {
    if (!current) return;
    setConfirming(false);
    setPlaying(false);
    await onDelete(current);
  };

  // Both panels below carry the same pair, so the film and the single
  // photo that cannot be played yet are corrected the same way.
  const actions = !current || editing ? null : confirming ? (
    <div className="flex gap-2">
      <Button variant="danger" className="!px-2" onClick={remove}>
        消す
      </Button>
      <Button className="!px-2" onClick={() => setConfirming(false)}>
        やめる
      </Button>
    </div>
  ) : (
    <div className="flex gap-2">
      <Button
        className="!px-2"
        onClick={() => {
          setPlaying(false);
          setConfirming(false);
          setEditing(current);
        }}
      >
        編集
      </Button>
      {/* Two steps, as on the meal card and the weight log: the button
          sits next to one people mean to press. */}
      <Button
        className="!px-2"
        onClick={() => {
          setPlaying(false);
          setConfirming(true);
        }}
      >
        削除
      </Button>
    </div>
  );

  const editForm = editing && (
    <PhotoEdit
      key={editing.id}
      photo={editing}
      onSave={async (patch) => {
        await onSave(editing, patch);
        setEditing(null);
      }}
      onCancel={() => setEditing(null)}
    />
  );

  if (photos.length < 2) {
    return (
      <Panel title="記録した写真" action={actions}>
        {editForm}
        <Strip photos={photos} urls={urls} index={index} onSeek={seek} />
        <p className="mt-3 text-xs text-muted">
          同じ場所・同じポーズでもう一枚撮ると、変化を再生できます。
        </p>
      </Panel>
    );
  }

  const elapsed = current && first ? daysBetween(first.date, current.date) : 0;
  const lost =
    current?.weightKg && first?.weightKg ? first.weightKg - current.weightKg : null;

  return (
    <Panel title="変化を見る" action={actions}>
      {editForm}
      <div className="relative overflow-hidden rounded-lg border border-rule/60 bg-sunk">
        {/* `object-contain`, not cover: photos taken on different days are
            framed slightly differently, and cropping each one to fill the
            box invents movement that is not in the body. */}
        <div className="relative h-80 w-full">
          {photos.map((photo, i) => (
            <img
              key={photo.id}
              src={loadWindow.has(photo.id) ? urls[photo.id] : undefined}
              alt={i === index ? `${photo.date} の記録` : ""}
              aria-hidden={i !== index}
              onLoad={() => setReady((r) => (r[photo.id] ? r : { ...r, [photo.id]: true }))}
              className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-100 ${
                i === index ? "opacity-100" : "opacity-0"
              }`}
            />
          ))}

          {!currentReady && (
            <div className="absolute inset-0 grid place-items-center">
              <span className="engraved text-xs">読み込んでいます</span>
            </div>
          )}
        </div>

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/55 to-transparent p-3">
          <span className="reading text-sm font-semibold text-white drop-shadow">
            {current?.date}
          </span>
          {current?.weightKg && (
            <span className="reading text-sm font-semibold text-white drop-shadow">
              {formatKg(current.weightKg)}kg
            </span>
          )}
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/55 to-transparent p-3">
          <span className="reading text-xs text-white/85 drop-shadow">
            {index + 1} / {photos.length}
            {elapsed > 0 && ` ・ ${elapsed}日目`}
          </span>
          {lost !== null && Math.abs(lost) >= 0.1 && (
            <span className="reading text-xs font-semibold text-white drop-shadow">
              {lost > 0 ? "−" : "+"}
              {formatKg(Math.abs(lost))}kg
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button variant="primary" onClick={playing ? () => setPlaying(false) : play}>
          {playing ? "とめる" : "再生"}
        </Button>
        <input
          type="range"
          min={0}
          max={photos.length - 1}
          step={1}
          value={index}
          aria-label="日付をたどる"
          onChange={(e) => {
            setPlaying(false);
            seek(Number(e.target.value));
          }}
          className="min-w-0 flex-1 accent-[color:var(--needle)]"
        />
      </div>

      <div className="mt-2 flex gap-1.5">
        {SPEEDS.map((option, i) => (
          <button
            key={option.label}
            type="button"
            onClick={() => setSpeed(i)}
            className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${
              i === speed
                ? "bg-needle/15 font-semibold text-ink"
                : "text-muted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-3 border-t border-rule/60 pt-3">
        <Strip
          photos={photos}
          urls={urls}
          index={index}
          onSeek={(i) => {
            setPlaying(false);
            seek(i);
          }}
        />
      </div>
    </Panel>
  );
}

/** Correcting one record. The photo and the model's reading of it are left
 *  alone: what a person knows better than the record is which day it was
 *  and what they weighed that morning — the number that gets stamped on
 *  before the analysis and never revisited. */
function PhotoEdit({
  photo,
  onSave,
  onCancel,
}: {
  photo: BodyPhotoRecord;
  onSave: (patch: { date: string; weightKg?: number }) => Promise<void>;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(photo.date);
  const [weightKg, setWeightKg] = useState(
    photo.weightKg === undefined ? "" : String(photo.weightKg),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!date) {
      setError("日付を入れてください");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({ date, weightKg: weightKg ? Number(weightKg) : undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="mb-4 space-y-3 rounded-lg border border-rule/60 bg-sunk p-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="日付">
          <TextInput
            type="date"
            value={date}
            max={todayKey()}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="体重" hint="空にすると消えます">
          <NumberInput
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            step="0.1"
            suffix="kg"
            placeholder="78.0"
          />
        </Field>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        写真と読み取り結果はそのままです。撮ってから量った体重は、ここで入れ直せます。
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy}>
          保存
        </Button>
        <Button type="button" onClick={onCancel}>
          やめる
        </Button>
      </div>
    </form>
  );
}

/** The thumbnails, doubling as the seek bar you can aim at. */
function Strip({
  photos,
  urls,
  index,
  onSeek,
}: {
  photos: BodyPhotoRecord[];
  urls: Record<string, string>;
  index: number;
  onSeek: (index: number) => void;
}) {
  const current = useRef<HTMLButtonElement>(null);

  // Playback walks off the end of the visible strip within a few frames.
  useEffect(() => {
    current.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [index]);

  return (
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
      {photos.map((photo, i) => (
        <button
          key={photo.id}
          ref={i === index ? current : undefined}
          type="button"
          onClick={() => onSeek(i)}
          className="w-20 shrink-0 text-left"
        >
          {urls[photo.id] ? (
            <img
              src={urls[photo.id]}
              alt={`${photo.date} の記録`}
              loading="lazy"
              className={`h-28 w-20 rounded-lg border object-cover transition-opacity ${
                i === index
                  ? "border-needle opacity-100"
                  : "border-rule/60 opacity-60"
              }`}
            />
          ) : (
            <div className="h-28 w-20 rounded-lg border border-rule/60 bg-sunk" />
          )}
          <span className="reading mt-1 block text-center text-[11px]">
            {photo.date.slice(5)}
          </span>
          {photo.weightKg && (
            <span className="reading block text-center text-[11px] font-semibold">
              {formatKg(photo.weightKg)}kg
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
