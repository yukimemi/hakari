// The user document — profile, goal, settings, latest body analysis — is
// read by nearly every screen, and every screen behind the gate is entitled
// to assume it is already there. That only holds if there is exactly one
// subscription: a per-component `useEffect` would hand each page an empty
// object on its first render, which is how `user.profile!` turns into a
// blank screen. Hence a context, populated once above the routes.
//
// Split from the provider component so this module exports no components
// (React Fast Refresh).

import { createContext, useContext } from "react";
import type { UserDoc } from "./store";

export type UserDocState = {
  data: UserDoc;
  loading: boolean;
  error: Error | null;
};

export const UserDocContext = createContext<UserDocState | undefined>(undefined);

export function useUserDoc(): UserDocState {
  const ctx = useContext(UserDocContext);
  if (!ctx) throw new Error("useUserDoc must be used inside <UserDocProvider>");
  return ctx;
}
