import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProtectedAdminShell } from "../src/auth/ProtectedAdminShell";

describe("ProtectedAdminShell", () => {
  it("renders the default blocked shell without privileged content", () => {
    render(
      <ProtectedAdminShell>
        <div>privileged business panel</div>
      </ProtectedAdminShell>
    );

    expect(screen.getByRole("heading", { name: "Admin authentication is not configured yet" })).toBeInTheDocument();
    expect(screen.getAllByText("not_configured").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("blocked")).toBeInTheDocument();
    expect(screen.getByText("The same-origin admin session sentinel reports not_configured.", { exact: false }))
      .toBeInTheDocument();
    expect(screen.getByText("not loaded")).toBeInTheDocument();
    expect(screen.queryByText("privileged business panel")).not.toBeInTheDocument();
    expect(screen.queryByText(/admin@example|tenant id|feed count/i)).not.toBeInTheDocument();
  });

  it("keeps authority-required state blocked", () => {
    render(
      <ProtectedAdminShell
        state={{
          kind: "authority_required",
          requirements: ["browser_session_authority", "role_permission_model"]
        }}
      >
        <div>future admin surface</div>
      </ProtectedAdminShell>
    );

    expect(screen.getByText("authority_required")).toBeInTheDocument();
    expect(screen.getByText(/future authority-backed auth\/session milestone/i)).toBeInTheDocument();
    expect(screen.queryByText("future admin surface")).not.toBeInTheDocument();
  });

  it("keeps unavailable, invalid, timeout, and checking session states blocked", () => {
    const sessionStates = [
      { kind: "checking", message: "Checking admin authentication status." },
      { kind: "auth_unavailable", message: "Admin authentication status is unavailable." },
      { kind: "invalid_response", message: "Admin authentication status could not be validated." },
      { kind: "timeout", message: "Admin authentication status timed out." }
    ] as const;

    for (const sessionStatus of sessionStates) {
      const { unmount } = render(
        <ProtectedAdminShell sessionStatus={sessionStatus}>
          <div>admin write controls</div>
        </ProtectedAdminShell>
      );

      expect(screen.queryByText("admin write controls")).not.toBeInTheDocument();
      expect(screen.getAllByText(sessionStatus.kind).length).toBeGreaterThanOrEqual(1);
      unmount();
    }
  });
});
