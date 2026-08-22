// The demonstration, when a generated video stands in for the avatar.
//
// A clip is a lottery ticket: Veo returns something plausible, or it
// returns a person doing a different exercise with three arms. So nothing
// is adopted until it has been watched. Generate, look, regenerate, and
// only then commit — which is what the owner asked for, and also the only
// honest way to spend forty cents a press.
//
// Generating is owner-only, matching the invite list. Everyone else sees
// whatever was adopted, or the 3D avatar when nothing has been.

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { adoptClip, clipUrl, discardClip, type ClipRef } from "../data/clips";
import { Alert, Button } from "./ui";
import Scanning from "./Scanning";

type Take = { path: string; url: string };

export default function ClipStage({
  exerciseId,
  adopted,
  canGenerate,
  className = "",
}: {
  exerciseId: string;
  adopted?: ClipRef;
  canGenerate: boolean;
  className?: string;
}) {
  const [take, setTake] = useState<Take | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  // Storage URLs are signed and short-lived, so they are fetched per view
  // rather than stored. Keyed by the path it was fetched for, so switching
  // exercises shows nothing rather than the previous clip.
  const [resolved, setResolved] = useState<{ path: string; url: string } | null>(
    null,
  );
  const adoptedUrl =
    resolved && adopted && resolved.path === adopted.path ? resolved.url : null;

  useEffect(() => {
    const path = adopted?.path;
    if (!path) return;
    let stale = false;
    clipUrl(path)
      .then((url) => {
        if (!stale) setResolved({ path, url });
      })
      .catch(() => {
        /* a clip that will not load is the same as none */
      });
    return () => {
      stale = true;
    };
  }, [adopted?.path]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const { operation } = await api.startClip({ exerciseId });
      // Eleven seconds at best, six minutes at worst, so this polls rather
      // than holding a request open.
      for (let attempt = 0; attempt < 60 && !cancelled.current; attempt++) {
        await new Promise((resolve) => window.setTimeout(resolve, 6000));
        const status = await api.clipStatus({ operation, exerciseId });
        if (status.done && status.path) {
          const url = await clipUrl(status.path);
          if (!cancelled.current) setTake({ path: status.path, url });
          return;
        }
      }
      if (!cancelled.current) setError("時間内に生成が終わりませんでした");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "生成に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const showing = take?.url ?? adoptedUrl;

  return (
    <div className={className}>
      {error && <Alert tone="error">{error}</Alert>}

      {showing && (
        <video
          key={showing}
          src={showing}
          className="w-full rounded-lg bg-sunk"
          autoPlay
          loop
          muted
          playsInline
          controls={false}
        />
      )}

      {busy && (
        <Scanning
          variant="panel"
          everySec={12}
          steps={[
            "動画を生成しています",
            "しばらくかかります（最大 6 分）",
            "まだ生成中です",
          ]}
        />
      )}

      {canGenerate && !busy && (
        <div className="mt-2 flex flex-wrap gap-2">
          {take ? (
            <>
              <Button
                variant="primary"
                onClick={async () => {
                  await adoptClip(exerciseId, take.path, adopted?.path);
                  setTake(null);
                }}
              >
                これにする
              </Button>
              <Button onClick={generate}>撮り直す</Button>
              <Button
                onClick={async () => {
                  await discardClip(take.path);
                  setTake(null);
                }}
              >
                捨てる
              </Button>
            </>
          ) : (
            <Button onClick={generate}>
              {adopted ? "動画を作り直す" : "AI で動画を作る"}
            </Button>
          )}
        </div>
      )}

      {take && (
        <p className="mt-2 text-xs text-muted">
          試写中です。「これにする」を押すまで保存されません。
        </p>
      )}
    </div>
  );
}
