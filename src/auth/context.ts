// Auth context object and its hooks, split from the provider component so
// the provider module exports only components (React Fast Refresh).

import { createContext, useContext } from "react";
import type { User } from "firebase/auth";

export type AuthState = {
  user: User | null;
  loading: boolean;
  configured: boolean;
  signIn: () => Promise<void>;
  signOutUser: () => Promise<void>;
};

export const AuthContext = createContext<AuthState | undefined>(undefined);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Narrowed accessor for screens that already sit behind the auth gate. */
export function useUid(): string {
  const { user } = useAuth();
  if (!user) throw new Error("認証済みの画面でのみ使用できます");
  return user.uid;
}
