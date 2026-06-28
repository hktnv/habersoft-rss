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

    expect(screen.getByRole("heading", { name: "Admin access is not configured yet" })).toBeInTheDocument();
    expect(screen.getByText("not_configured")).toBeInTheDocument();
    expect(screen.getByText("blocked")).toBeInTheDocument();
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
});
