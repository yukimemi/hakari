// Who is allowed in.
//
// The app is on a public URL, and a public URL with Google sign-in means
// anyone with a Google account — which would give them not just their own
// corner of the database but the ability to spend the owner's AI credits
// through /api/*. So sign-in alone is not authorisation.
//
// The owner is a constant: it is the bootstrap, and it is what makes it
// impossible to lock yourself out of your own deployment. Everyone else
// lives in the Firestore document `config/access`, which the owner edits
// from the settings screen — inviting someone should not need a deploy.
//
// The security rules read the same document, so the list is enforced in
// three places from two sources: this constant (owner) and that document
// (guests). Nothing here is secret; the enforcement is in the rules and in
// requireUser, not in keeping the addresses hidden.

export const OWNER_EMAIL = "yukimemi@gmail.com";

/** Firestore path of the invite list. Mirrored in firestore.rules and
 *  storage.rules — grep for `config/access` before changing it. */
export const ACCESS_DOC = { collection: "config", id: "access" } as const;

export type AccessDoc = {
  /** Lower-cased addresses. The owner is never in here. */
  allowedEmails?: string[];
};

/** Google addresses are case-insensitive; a token carries whatever the
 *  account was created with. */
export function normalizeEmail(email: string | undefined | null): string {
  return (email ?? "").trim().toLowerCase();
}

export function isOwner(email: string | undefined | null): boolean {
  return normalizeEmail(email) === OWNER_EMAIL;
}

export function isInvited(
  email: string | undefined | null,
  access: AccessDoc | undefined,
): boolean {
  const target = normalizeEmail(email);
  if (!target) return false;
  return (access?.allowedEmails ?? []).some(
    (allowed) => normalizeEmail(allowed) === target,
  );
}

export function hasAccess(
  email: string | undefined | null,
  access: AccessDoc | undefined,
): boolean {
  return isOwner(email) || isInvited(email, access);
}
