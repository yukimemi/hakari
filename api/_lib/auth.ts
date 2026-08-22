/// <reference types="node" />
// Vercel type-checks functions with its own tsconfig, which does not pull
// in the node types our tsconfig.node.json declares; without this the
// build log fills with "Cannot find name 'process'".
// Firebase ID token verification for the API routes.
//
// Deliberately not firebase-admin: that would need a service-account key
// in the Vercel env just to check a signature. Firebase publishes its
// signing keys as a JWKS, so `jose` verifies the token with nothing but
// the project id — which is public anyway.

import { createRemoteJWKSet, jwtVerify } from "jose";
import { ACCESS_DOC, isOwner, normalizeEmail } from "../../shared/access.js";

const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

// Module scope so the key set is cached across warm invocations.
const jwks = createRemoteJWKSet(new URL(JWKS_URL));

export class AuthError extends Error {
  readonly status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

function projectId(): string {
  const id =
    process.env.FIREBASE_PROJECT_ID ?? process.env.VITE_FIREBASE_PROJECT_ID;
  if (!id) {
    throw new AuthError(
      "FIREBASE_PROJECT_ID が未設定です (サーバ側の設定漏れ)",
      500,
    );
  }
  return id;
}

// A guest's invitation is checked against Firestore, which is a network
// round trip we do not want on every single call. Warm invocations reuse
// the answer briefly; revoking an invite therefore takes effect within a
// minute rather than instantly, which is the right trade for a list the
// owner edits by hand.
const INVITE_TTL_MS = 60_000;
const inviteCache = new Map<string, { allowed: boolean; at: number }>();

/**
 * Reads `config/access` as the caller. The security rules only let an
 * invited address read that document, so a denial is itself the answer —
 * and because the read runs with the caller's own token, this route needs
 * no service-account credentials of its own.
 */
async function isInvited(email: string, idToken: string): Promise<boolean> {
  const cached = inviteCache.get(email);
  if (cached && Date.now() - cached.at < INVITE_TTL_MS) return cached.allowed;

  const url =
    `https://firestore.googleapis.com/v1/projects/${projectId()}` +
    `/databases/(default)/documents/${ACCESS_DOC.collection}/${ACCESS_DOC.id}`;

  let allowed = false;
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (response.ok) {
      const body = (await response.json()) as {
        fields?: {
          allowedEmails?: { arrayValue?: { values?: { stringValue?: string }[] } };
        };
      };
      const list = body.fields?.allowedEmails?.arrayValue?.values ?? [];
      allowed = list.some((v) => normalizeEmail(v.stringValue) === email);
    }
  } catch {
    // A Firestore outage must not become an open door.
    allowed = false;
  }

  inviteCache.set(email, { allowed, at: Date.now() });
  return allowed;
}

export type AuthedUser = {
  uid: string;
  email: string;
  /** The verified token, so callers can reach Firestore as this user
   *  without the route needing credentials of its own. */
  idToken: string;
};

/**
 * Extracts and verifies the `Authorization: Bearer <idToken>` header, then
 * checks that the address behind it is allowed to use this deployment.
 * Throws `AuthError` when the token is missing, expired, not issued by
 * this Firebase project, or belongs to someone who was not invited.
 */
export async function requireUser(request: Request): Promise<AuthedUser> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new AuthError("ログインが必要です");
  }
  const token = header.slice("Bearer ".length).trim();
  const id = projectId();

  let uid: string;
  let email: string;
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `https://securetoken.google.com/${id}`,
      audience: id,
    });
    // `sub` is the Firebase uid. Firebase also sets `user_id`, but `sub`
    // is the standard claim and is always present.
    if (!payload.sub) throw new AuthError("トークンに uid がありません");
    if (payload.email_verified === false) {
      throw new AuthError("メールアドレスが確認されていません", 403);
    }
    uid = payload.sub;
    email = normalizeEmail(payload.email as string | undefined);
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError("認証トークンが無効です");
  }

  // A valid token only proves the caller owns a Google account. Being on
  // the list is what decides whether this deployment is theirs to use —
  // without it a public URL hands the owner's AI credits to anyone.
  if (!isOwner(email) && !(await isInvited(email, token))) {
    throw new AuthError("このアカウントは招待されていません", 403);
  }

  return { uid, email, idToken: token };
}
