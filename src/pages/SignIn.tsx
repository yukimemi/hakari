// Sign-in. One button, and a hero that shows the instrument rather than
// describing it — the beam is what the app is.

import { useState } from "react";
import { useAuth } from "../auth/context";
import BeamScale from "../components/BeamScale";
import { Alert, Button } from "../components/ui";

export default function SignIn() {
  const { signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "サインインに失敗しました",
      );
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-8 px-6 py-12">
      <div>
        <h1 className="reading text-5xl font-bold tracking-tight">hakari</h1>
        <p className="engraved mt-1">秤 — measure, then move</p>
      </div>

      <div className="rounded-panel border border-rule/60 bg-panel p-4 shadow-panel">
        <BeamScale startKg={82.5} currentKg={78.2} targetKg={68} />
      </div>

      <div className="space-y-3 text-sm leading-relaxed">
        <p>
          食事は<strong>写真を撮るだけ</strong>。
          料理を見分けて、分量からカロリーと PFC を出します。
        </p>
        <p>
          全身写真から体型を読み取って 3D に起こし、
          目標体重まで痩せた姿を先に見せます。
        </p>
        <p>
          そこから逆算したトレーニングを、
          3D のトレーナーが実演します。
        </p>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="space-y-3">
        <Button variant="primary" size="lg" loading={busy} onClick={onSignIn}>
          Google で始める
        </Button>
        <p className="text-center text-xs text-muted">
          記録はあなたのアカウントにのみ保存されます
        </p>
      </div>
    </div>
  );
}
