// @vitest-environment jsdom
//
// The whole point of this hook is a browser behaviour, so the test drives
// the real history rather than the hook: open a sub-view, press back, and
// check the page is showing again. Asserting that `close()` was called
// would prove nothing about the back button — which is what broke.
//
// BrowserRouter, not MemoryRouter, for the same reason: MemoryRouter
// keeps its own stack and would sit there unmoved while
// `history.back()` did nothing.

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useSubView } from "./subview";

function Training() {
  const demo = useSubView("do");
  return demo.value ? (
    <div>
      <p>demo:{demo.value}</p>
      <button onClick={demo.close}>とじる</button>
    </div>
  ) : (
    <button onClick={() => demo.open("0.squat")}>スクワット</button>
  );
}

function mount(at: string) {
  window.history.replaceState(null, "", at);
  return render(
    <BrowserRouter>
      <Routes>
        <Route path="/training" element={<Training />} />
      </Routes>
    </BrowserRouter>,
  );
}

const click = (label: string) =>
  act(() => {
    screen.getByText(label).click();
  });

/** jsdom applies `back()` and fires popstate in later tasks, so it has
 *  to be awaited — and one macrotask is not always enough. */
const back = async () => {
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
};

afterEach(cleanup);

describe("useSubView", () => {
  it("opens into history, so back returns to the page", async () => {
    mount("/training");
    click("スクワット");
    expect(screen.getByText("demo:0.squat")).toBeTruthy();

    await back();

    expect(screen.queryByText("demo:0.squat")).toBeNull();
    expect(screen.getByText("スクワット")).toBeTruthy();
  });

  it("closes without leaving the app when the view was deep-linked", () => {
    // The entry react-router did not push. `navigate(-1)` here would go
    // wherever the browser was before the app, so this case has to drop
    // the parameter in place instead.
    mount("/training?do=0.squat");
    expect(screen.getByText("demo:0.squat")).toBeTruthy();

    click("とじる");

    expect(screen.queryByText("demo:0.squat")).toBeNull();
    expect(screen.getByText("スクワット")).toBeTruthy();
  });

  it("leaves the page's other parameters alone", () => {
    mount("/training?tab=week");
    click("スクワット");
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("week");
    click("とじる");
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("week");
  });
});
