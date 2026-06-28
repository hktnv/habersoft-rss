import { useId, useState, type FormEvent, type ReactNode } from "react";
import type { AdminSessionStatus } from "./adminSessionClient";
import {
  canRenderProtectedAdminContent,
  describeAdminAuthBoundaryState,
  resolveAdminAuthBoundaryState,
  type AdminAuthBoundaryState
} from "./adminSessionBoundary";

export type ProtectedAdminShellProps = {
  readonly state?: AdminAuthBoundaryState;
  readonly sessionStatus?: AdminSessionStatus;
  readonly busy?: boolean;
  readonly onLogin?: (username: string, password: string) => Promise<AdminSessionStatus>;
  readonly onLogout?: () => Promise<AdminSessionStatus>;
  readonly children?: ReactNode;
};

export function ProtectedAdminShell({
  state = resolveAdminAuthBoundaryState(),
  sessionStatus = {
    kind: "not_configured",
    message: "Admin authentication is not configured."
  },
  busy = false,
  onLogin,
  onLogout,
  children
}: ProtectedAdminShellProps) {
  const canRender = canRenderProtectedAdminContent(state, sessionStatus);
  const sessionDescription = describeSessionStatus(sessionStatus);

  return (
    <section
      className="protected-admin-shell"
      aria-labelledby="protected-admin-shell-title"
      data-state={state.kind}
      data-session-state={sessionStatus.kind}
    >
      <div className="protected-admin-gate">
        <div>
          <p className="eyebrow">Habersoft RSS</p>
          <h1 id="protected-admin-shell-title">{sessionDescription.heading}</h1>
          <p className="lede">{sessionDescription.message}</p>
        </div>

        <dl className="protected-admin-status" aria-label="Protected admin boundary status">
          <div>
            <dt>Boundary state</dt>
            <dd>{state.kind}</dd>
          </div>
          <div>
            <dt>Admin content</dt>
            <dd>{canRender ? "unlocked" : "blocked"}</dd>
          </div>
          <div>
            <dt>Session contract</dt>
            <dd>{sessionStatus.kind}</dd>
          </div>
          <div>
            <dt>Privileged data</dt>
            <dd>not loaded</dd>
          </div>
        </dl>

        <p className="safe-message">
          {describeAdminAuthBoundaryState(state)} No Tenant bearer, Agent key, or business write credential is present
          in the browser.
        </p>

        {sessionStatus.kind === "unauthenticated" && onLogin !== undefined ? (
          <AdminLoginForm busy={busy} onLogin={onLogin} />
        ) : null}

        {sessionStatus.kind === "authenticated" && onLogout !== undefined ? (
          <div className="authenticated-toolbar">
            <p>
              Signed in as <strong>{sessionStatus.principal.displayName}</strong>
            </p>
            <button type="button" onClick={() => void onLogout()} disabled={busy} aria-busy={busy}>
              Sign out
            </button>
          </div>
        ) : null}
      </div>

      {canRender ? <div className="protected-admin-slot">{children}</div> : null}
    </section>
  );
}

function AdminLoginForm({
  busy,
  onLogin
}: {
  readonly busy: boolean;
  readonly onLogin: (username: string, password: string) => Promise<AdminSessionStatus>;
}) {
  const usernameId = useId();
  const passwordId = useId();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    const status = await onLogin(username, password);
    if (status.kind !== "authenticated") {
      setPassword("");
      setError(status.kind === "unauthenticated" ? "Admin sign-in was not accepted." : status.message);
    }
  };

  return (
    <form className="admin-login-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor={usernameId}>Username</label>
      <input
        id={usernameId}
        name="username"
        autoComplete="username"
        value={username}
        disabled={busy}
        onChange={(event) => setUsername(event.target.value)}
      />

      <label htmlFor={passwordId}>Password</label>
      <input
        id={passwordId}
        name="password"
        type="password"
        autoComplete="current-password"
        value={password}
        disabled={busy}
        onChange={(event) => setPassword(event.target.value)}
      />

      {error === undefined ? null : (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy || username === "" || password === ""} aria-busy={busy}>
        {busy ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}

function describeSessionStatus(status: AdminSessionStatus): { readonly heading: string; readonly message: string } {
  switch (status.kind) {
    case "unknown":
    case "checking":
      return {
        heading: "Checking admin access",
        message: "The admin session is being verified."
      };
    case "not_configured":
      return {
        heading: "Admin authentication is not configured",
        message: "The same-origin admin session contract is closed until server-side auth is configured."
      };
    case "unauthenticated":
      return {
        heading: "Admin sign-in required",
        message: "Enter the configured local admin credential."
      };
    case "authenticated":
      return {
        heading: "Admin session active",
        message: "The protected admin surface is available for credential-free health observation."
      };
    case "auth_unavailable":
    case "invalid_response":
    case "timeout":
      return {
        heading: "Admin access cannot be verified",
        message: status.message
      };
  }
}
