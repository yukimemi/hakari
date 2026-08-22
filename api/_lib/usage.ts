/// <reference types="node" />
// A daily cap on AI calls, counted per user.
//
// The point is not to police invited people — you invite people you trust
// — but to bound the damage from a loop, a stuck retry, or a phone left
// on a screen that keeps asking. Without it a single bug spends real money
// until someone notices.
//
// The counter lives at users/{uid}/usage/{yyyy-MM-dd}, and the security
// rules only permit it to go up by exactly one and never to be deleted.
// That matters because this route writes with the *caller's* token, which
// means the caller could otherwise reach the same document from the
// browser and reset it — a limit that the limited party can clear is not
// a limit.

import { AuthError } from "./auth.js";

export class UsageError extends Error {
  readonly status = 429;

  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

const DEFAULT_DAILY_LIMIT = 60;

function dailyLimit(): number {
  const raw = Number(process.env.DAILY_CALL_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DAILY_LIMIT;
}

/** Vercel runs in UTC, so "today" has to be asked for explicitly or the
 *  day would roll over at 09:00 JST. en-CA formats as YYYY-MM-DD. */
function todayInTokyo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );
}

function docUrl(uid: string, date: string): string {
  const project =
    process.env.FIREBASE_PROJECT_ID ?? process.env.VITE_FIREBASE_PROJECT_ID;
  if (!project) {
    throw new AuthError("FIREBASE_PROJECT_ID が未設定です", 500);
  }
  return (
    `https://firestore.googleapis.com/v1/projects/${project}` +
    `/databases/(default)/documents/users/${uid}/usage/${date}`
  );
}

/**
 * Counts one AI call against the caller's daily allowance, refusing the
 * request when it is used up.
 *
 * Read-then-write rather than an atomic transform: two calls arriving in
 * the same instant can undercount by one, which for a per-day ceiling is
 * not worth a transaction.
 */
export async function consumeCall(
  uid: string,
  idToken: string,
  opts: {
    /** Which allowance to draw on. Video costs by the second and text by
     *  the token, so they are counted apart — a generous limit on one must
     *  not become a generous limit on the other. Each bucket is its own
     *  document, so the monotonic rule that makes the counter tamper-proof
     *  applies unchanged. */
    bucket?: string;
    limit?: number;
  } = {},
): Promise<{ used: number; limit: number }> {
  const limit = opts.limit ?? dailyLimit();
  const date = opts.bucket ? `${todayInTokyo()}-${opts.bucket}` : todayInTokyo();
  const url = docUrl(uid, date);
  const auth = { Authorization: `Bearer ${idToken}` };

  const current = await fetch(url, { headers: auth });
  let used = 0;
  if (current.ok) {
    const body = (await current.json()) as {
      fields?: { calls?: { integerValue?: string } };
    };
    used = Number(body.fields?.calls?.integerValue ?? 0) || 0;
  } else if (current.status !== 404) {
    // Anything other than "no calls yet today" means we cannot account for
    // this call, and an unaccountable call is one we decline to make.
    throw new UsageError("利用状況を確認できませんでした");
  }

  if (used >= limit) {
    throw new UsageError(
      opts.bucket === "clip"
        ? `今日の動画生成の上限 (${limit} 本) に達しました。日付が変わると戻ります。`
        : `今日の AI 呼び出し上限 (${limit} 回) に達しました。日付が変わると戻ります。`,
    );
  }

  const next = used + 1;
  const written = await fetch(`${url}?updateMask.fieldPaths=calls`, {
    method: "PATCH",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { calls: { integerValue: String(next) } } }),
  });
  if (!written.ok) {
    throw new UsageError("利用状況を記録できませんでした");
  }

  return { used: next, limit };
}
