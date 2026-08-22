import { useEffect, useMemo, useState } from "react";
import { useUid } from "../auth/context";
import { watchUser } from "./store";
import { UserDocContext, type UserDocState } from "./userDocContext";

type Loaded = UserDocState & { uid: string | null };

const EMPTY: UserDocState = { data: {}, loading: true, error: null };

/** Holds the single live subscription to the signed-in user's document. */
export function UserDocProvider({ children }: { children: React.ReactNode }) {
  const uid = useUid();
  const [loaded, setLoaded] = useState<Loaded>({ ...EMPTY, uid: null });

  useEffect(() => {
    return watchUser(
      uid,
      (data) => setLoaded({ data, loading: false, error: null, uid }),
      (error) => setLoaded({ data: {}, loading: false, error, uid }),
    );
  }, [uid]);

  // Which account the held snapshot belongs to is part of the state, so a
  // sign-out and sign-in as someone else reads as "loading" during the
  // render that switches uid — rather than briefly showing the previous
  // account's figures, which is what resetting inside the effect would do.
  const value = useMemo<UserDocState>(
    () => (loaded.uid === uid ? loaded : EMPTY),
    [loaded, uid],
  );

  return <UserDocContext.Provider value={value}>{children}</UserDocContext.Provider>;
}
