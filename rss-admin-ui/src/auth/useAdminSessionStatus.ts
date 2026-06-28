import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkingAdminSessionStatus,
  fetchAdminSessionStatus,
  loginAdminSession,
  logoutAdminSession,
  type AdminSessionStatus
} from "./adminSessionClient";

export type AdminSessionController = {
  readonly status: AdminSessionStatus;
  readonly busy: boolean;
  readonly refresh: () => Promise<AdminSessionStatus>;
  readonly login: (username: string, password: string) => Promise<AdminSessionStatus>;
  readonly logout: () => Promise<AdminSessionStatus>;
};

export function useAdminSessionController(): AdminSessionController {
  const [status, setStatus] = useState<AdminSessionStatus>(checkingAdminSessionStatus);
  const [busy, setBusy] = useState(true);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | undefined>(undefined);

  const run = useCallback(
    async (request: (signal: AbortSignal) => Promise<AdminSessionStatus>, showChecking: boolean) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      abortRef.current?.abort();

      const controller = new AbortController();
      abortRef.current = controller;
      if (showChecking) setStatus(checkingAdminSessionStatus);
      setBusy(true);

      try {
        const nextStatus = await request(controller.signal);
        if (requestIdRef.current === requestId) {
          setStatus(nextStatus);
        }
        return nextStatus;
      } finally {
        if (requestIdRef.current === requestId) {
          setBusy(false);
          abortRef.current = undefined;
        }
      }
    },
    []
  );

  const refresh = useCallback(
    () => run((signal) => fetchAdminSessionStatus({ signal }), true),
    [run]
  );

  const login = useCallback(
    (username: string, password: string) =>
      run((signal) => loginAdminSession({ username, password, signal }), false),
    [run]
  );

  const logout = useCallback(
    () => run((signal) => logoutAdminSession({ signal }), false),
    [run]
  );

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    const controller = new AbortController();
    abortRef.current = controller;
    let active = true;

    void fetchAdminSessionStatus({ signal: controller.signal }).then((nextStatus) => {
      if (active && requestIdRef.current === requestId) {
        setStatus(nextStatus);
        setBusy(false);
        abortRef.current = undefined;
      }
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return {
    status,
    busy,
    refresh,
    login,
    logout
  };
}

export function useAdminSessionStatus(): AdminSessionStatus {
  return useAdminSessionController().status;
}
