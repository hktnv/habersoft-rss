import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProtectedAdminShell } from "../src/auth/ProtectedAdminShell";

describe("ProtectedAdminShell", () => {
  it("renders the default blocked shell without privileged content", () => {
    render(
      <ProtectedAdminShell>
        <div>privileged business panel</div>
      </ProtectedAdminShell>
    );

    expect(screen.getByRole("heading", { name: "Admin authentication is not configured" })).toBeInTheDocument();
    expect(screen.getByText("same_origin_session")).toBeInTheDocument();
    expect(screen.getByText("blocked")).toBeInTheDocument();
    expect(screen.getByText("not loaded")).toBeInTheDocument();
    expect(screen.queryByText("privileged business panel")).not.toBeInTheDocument();
    expect(screen.queryByText(/admin@example|tenant id|feed count/i)).not.toBeInTheDocument();
  });

  it("renders the login form when auth is configured but unauthenticated", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn().mockResolvedValue({
      kind: "authenticated",
      message: "Admin session is authenticated.",
      principal: { kind: "single_admin", displayName: "Admin" },
      expiresAt: "2026-06-20T00:00:00.000Z",
      csrfToken
    });

    render(
      <ProtectedAdminShell
        sessionStatus={{ kind: "unauthenticated", message: "Admin authentication is required." }}
        onLogin={onLogin}
      />
    );

    await user.type(screen.getByLabelText("Username"), "admin");
    await user.type(screen.getByLabelText("Password"), "test-only-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(onLogin).toHaveBeenCalledWith("admin", "test-only-password");
  });

  it("renders protected content and logout only after an authenticated session", async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn().mockResolvedValue({
      kind: "unauthenticated",
      message: "Admin authentication is required."
    });

    render(
      <ProtectedAdminShell
        sessionStatus={{
          kind: "authenticated",
          message: "Admin session is authenticated.",
          principal: { kind: "single_admin", displayName: "Admin" },
          expiresAt: "2026-06-20T00:00:00.000Z",
          csrfToken
        }}
        onLogout={onLogout}
      >
        <div>protected health dashboard</div>
      </ProtectedAdminShell>
    );

    expect(screen.getByText("unlocked")).toBeInTheDocument();
    expect(screen.getByText("protected health dashboard")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("keeps authority-required and unhealthy session states blocked", () => {
    const sessionStates = [
      { kind: "checking", message: "Checking admin authentication status." },
      { kind: "auth_unavailable", message: "Admin authentication status is unavailable." },
      { kind: "invalid_response", message: "Admin authentication status could not be validated." },
      { kind: "timeout", message: "Admin authentication status timed out." }
    ] as const;

    render(
      <ProtectedAdminShell
        state={{
          kind: "authority_required",
          requirements: ["role_permission_model"]
        }}
        sessionStatus={{
          kind: "authenticated",
          message: "Admin session is authenticated.",
          principal: { kind: "single_admin", displayName: "Admin" },
          expiresAt: "2026-06-20T00:00:00.000Z",
          csrfToken
        }}
      >
        <div>future admin surface</div>
      </ProtectedAdminShell>
    );
    expect(screen.queryByText("future admin surface")).not.toBeInTheDocument();

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

const csrfToken = "csrf_token_value_at_least_32_characters";
