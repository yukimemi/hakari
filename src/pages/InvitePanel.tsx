// Managing who else may use this deployment.
//
// Only the owner sees this, and only the owner can write the document —
// the rules enforce that, so a guest reaching this code by any means would
// simply get a permission error from Firestore.
//
// Invitations are by address alone: the invitee needs no account here
// beforehand. Their first Google sign-in matches on the address.

import { useState } from "react";
import { useAccess } from "../data/hooks";
import { saveAllowedEmails } from "../data/store";
import { OWNER_EMAIL, normalizeEmail } from "../../shared/access";
import { Alert, Button, Panel, TextInput } from "../components/ui";

export default function InvitePanel() {
  const { access, loading } = useAccess();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const emails = access.allowedEmails ?? [];

  const write = async (next: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await saveAllowedEmails(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const email = normalizeEmail(draft);
    if (!email) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError("メールアドレスの形式が正しくありません");
      return;
    }
    if (email === OWNER_EMAIL) {
      setError("持ち主は招待しなくても使えます");
      return;
    }
    if (emails.some((e) => normalizeEmail(e) === email)) {
      setError("すでに招待しています");
      return;
    }
    setDraft("");
    await write([...emails, email]);
  };

  return (
    <Panel title="招待">
      {error && <Alert tone="error">{error}</Alert>}

      <p className="text-xs leading-relaxed text-muted">
        招待した Google アカウントだけがサインインできます。招待した人は
        自分の記録だけを持ち、あなたの記録は見えません。
      </p>

      <ul className="mt-3 divide-y divide-rule/60 text-sm">
        <li className="flex items-center justify-between gap-3 py-2.5">
          <span className="min-w-0 truncate">{OWNER_EMAIL}</span>
          <span className="engraved shrink-0 text-xs text-muted">持ち主</span>
        </li>
        {emails.map((email) => (
          <li key={email} className="flex items-center justify-between gap-3 py-2.5">
            <span className="min-w-0 truncate">{email}</span>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                write(emails.filter((e) => normalizeEmail(e) !== normalizeEmail(email)))
              }
              className="shrink-0 text-xs text-muted underline disabled:opacity-50"
            >
              取り消す
            </button>
          </li>
        ))}
        {!loading && emails.length === 0 && (
          <li className="py-2.5 text-xs text-muted">まだ誰も招待していません。</li>
        )}
      </ul>

      <div className="mt-3 flex gap-2">
        <TextInput
          className="flex-1"
          type="email"
          inputMode="email"
          autoComplete="off"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="someone@example.com"
          aria-label="招待する Google アカウント"
        />
        <Button className="shrink-0 whitespace-nowrap" onClick={add} loading={busy}>
          招待
        </Button>
      </div>

      <p className="mt-2 text-xs text-muted">
        取り消すとサインインできなくなります。API の呼び出しは最大 1 分ほど
        通ることがあります（サーバ側が判定を短時間だけ覚えているため）。
      </p>
    </Panel>
  );
}
