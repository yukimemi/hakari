// A render error used to leave a black screen and nothing else — the only
// way to find out what happened was the devtools console. This turns that
// into something readable, with the message kept visible rather than
// swallowed, because the person hitting it is the person maintaining it.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui";

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("render error", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md rounded-panel border border-rule bg-panel p-6 shadow-panel">
          <h1 className="text-lg font-semibold">画面を表示できませんでした</h1>
          <p className="mt-2 text-sm text-muted">
            記録は保存されています。読み込み直すと元に戻ることがほとんどです。
          </p>
          <pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-sunk p-3 text-xs text-muted">
            {error.message}
          </pre>
          <div className="mt-4 flex gap-2">
            <Button variant="primary" onClick={() => window.location.reload()}>
              読み込み直す
            </Button>
            <Button onClick={() => this.setState({ error: null })}>
              もう一度試す
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
