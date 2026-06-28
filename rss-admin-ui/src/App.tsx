import { ProtectedAdminShell } from "./auth/ProtectedAdminShell";
import { useAdminSessionController } from "./auth/useAdminSessionStatus";
import { StatusDashboard } from "./status/StatusDashboard";

export function App() {
  const adminSession = useAdminSessionController();

  return (
    <ProtectedAdminShell
      sessionStatus={adminSession.status}
      busy={adminSession.busy}
      onLogin={adminSession.login}
      onLogout={adminSession.logout}
    >
      <StatusDashboard />
    </ProtectedAdminShell>
  );
}
