import { ProtectedAdminShell } from "./auth/ProtectedAdminShell";
import { useAdminSessionStatus } from "./auth/useAdminSessionStatus";
import { StatusDashboard } from "./status/StatusDashboard";

export function App() {
  const adminSessionStatus = useAdminSessionStatus();

  return (
    <>
      <StatusDashboard />
      <ProtectedAdminShell sessionStatus={adminSessionStatus} />
    </>
  );
}
