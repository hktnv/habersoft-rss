import type { ReactNode } from "react";
import {
  canRenderProtectedAdminContent,
  describeAdminAuthBoundaryState,
  resolveAdminAuthBoundaryState,
  type AdminAuthBoundaryState
} from "./adminSessionBoundary";

export type ProtectedAdminShellProps = {
  readonly state?: AdminAuthBoundaryState;
  readonly children?: ReactNode;
};

export function ProtectedAdminShell({
  state = resolveAdminAuthBoundaryState(),
  children
}: ProtectedAdminShellProps) {
  const canRender = canRenderProtectedAdminContent(state);

  return (
    <section className="protected-admin-shell" aria-labelledby="protected-admin-shell-title" data-state={state.kind}>
      <div>
        <p className="eyebrow">Protected admin shell</p>
        <h2 id="protected-admin-shell-title">Admin access is not configured yet</h2>
        <p className="safe-message">
          This shell is intentionally blocked until an authority-backed admin auth/session milestone defines
          credentials, session storage, roles, and production activation evidence.
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
          <dt>Privileged data</dt>
          <dd>not loaded</dd>
        </div>
      </dl>
      <p className="safe-message">{describeAdminAuthBoundaryState(state)} No privileged data is loaded.</p>
      {canRender ? <div className="protected-admin-slot">{children}</div> : null}
    </section>
  );
}
