// Full-screen views that live inside a page, addressed by the URL.
//
// A demonstration opened from the training list used to be state, not
// history. Back left the page entirely and landed on the dashboard —
// which is not where anyone came from, and not what the button means.
// Putting the open view in a search parameter makes back close it, for
// free, because that is what back already does.

import { useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

export type SubView = {
  /** The open view's key, or null when the page itself is showing. */
  value: string | null;
  open: (value: string) => void;
  close: () => void;
};

export function useSubView(name: string): SubView {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const open = useCallback(
    (value: string) => {
      const next = new URLSearchParams(params);
      next.set(name, value);
      setParams(next);
    },
    [name, params, setParams],
  );

  const close = useCallback(() => {
    // `default` is the key react-router gives an entry it did not push —
    // a deep link, or a reload. Going back from there leaves the app
    // altogether, so that one case drops the parameter in place instead.
    if (location.key === "default") {
      const next = new URLSearchParams(params);
      next.delete(name);
      setParams(next, { replace: true });
    } else {
      navigate(-1);
    }
  }, [location.key, name, navigate, params, setParams]);

  return { value: params.get(name), open, close };
}
