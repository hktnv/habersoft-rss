import type { ReactNode } from "react";
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
  readonly children?: ReactNode;
};

export function ProtectedAdminShell({
  state = resolveAdminAuthBoundaryState(),
  sessionStatus = {
    kind: "not_configured",
    message: "Admin authentication is not configured."
  },
  children
}: ProtectedAdminShellProps) {
  const canRender = canRenderProtectedAdminContent(state);
  const sessionDescription = describeSessionStatus(sessionStatus);

  return (
    <section
      className="protected-admin-shell"
      aria-labelledby="protected-admin-shell-title"
      data-state={state.kind}
      data-session-state={sessionStatus.kind}
    >
      <div>
        <p className="eyebrow">Protected admin shell</p>
        <h2 id="protected-admin-shell-title">{sessionDescription.heading}</h2>
        <p className="safe-message">
          This protected shell remains blocked until an operator-authorized auth/session service is deployed behind
          the same-origin admin session contract.
        </p>
      </div>
      <dl className="protected-admin-status" aria-label="Protected admin boundary status">
        <div>
          <dt>Boundary state</dt>
          <dd>{state.kind}</dd>
        </div>
        <div>
          <dt>Admin content</dt>
          <dd>blocked</dd>
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
        {sessionDescription.message} {describeAdminAuthBoundaryState(state)} No privileged data is loaded.
      </p>
      {canRender ? <div className="protected-admin-slot">{children}</div> : null}
    </section>
  );
}

function describeSessionStatus(status: AdminSessionStatus): { readonly heading: string; readonly message: string } {
  switch (status.kind) {
    case "unknown":
    case "checking":
      return {
        heading: "Admin authentication is being checked",
        message: "Admin access cannot be verified yet."
      };
    case "not_configured":
      return {
        heading: "Admin authentication is not configured yet",
        message: "The same-origin admin session sentinel reports not_configured."
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
