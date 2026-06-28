import { useEffect, useState } from "react";
import {
  checkingAdminSessionStatus,
  fetchAdminSessionStatus,
  type AdminSessionStatus
} from "./adminSessionClient";

export function useAdminSessionStatus(): AdminSessionStatus {
  const [status, setStatus] = useState<AdminSessionStatus>(checkingAdminSessionStatus);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    void fetchAdminSessionStatus({ signal: controller.signal }).then((nextStatus) => {
      if (active) setStatus(nextStatus);
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return status;
}
