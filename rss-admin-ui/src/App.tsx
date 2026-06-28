import { ProtectedAdminShell } from "./auth/ProtectedAdminShell";
import { StatusDashboard } from "./status/StatusDashboard";

export function App() {
  return (
    <>
      <StatusDashboard />
      <ProtectedAdminShell />
    </>
  );
}
