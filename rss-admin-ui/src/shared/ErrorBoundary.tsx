import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  failed: boolean;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("rss-admin-ui shell failed", { error, componentStack: info.componentStack });
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="app-shell" role="alert">
          <section className="panel">
            <h1>Admin UI shell unavailable</h1>
            <p>Refresh the page after checking the runtime configuration.</p>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
