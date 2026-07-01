import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_SESSION_LOGIN_PATH,
  ADMIN_SESSION_LOGOUT_PATH,
  ADMIN_SESSION_SENTINEL_HTTP_STATUS,
  ADMIN_SESSION_STATUS_PATH,
  adminSessionClientContract,
  fetchAdminSessionStatus,
  isFailClosedAdminSessionStatus,
  loginAdminSession,
  logoutAdminSession,
  parseAdminSessionResponse,
  type FetchLike
} from "../src/auth/adminSessionClient";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("admin session client", () => {
  it("uses exact same-origin session GET semantics without custom credential headers", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValueOnce(sentinelResponse());

    const status = await fetchAdminSessionStatus({ fetchImpl });

    expect(status).toMatchObject({ kind: "not_configured", httpStatus: ADMIN_SESSION_SENTINEL_HTTP_STATUS });
    expect(fetchImpl).toHaveBeenCalledWith(
      ADMIN_SESSION_STATUS_PATH,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "manual",
        headers: { Accept: "application/json" }
      })
    );
    expect(JSON.stringify(fetchImpl.mock.calls[0]?.[1])).not.toMatch(/Authorization|Cookie|AGENT_KEY|X-Agent-Key/iu);
    expect(fetchImpl.mock.calls[0]?.[1]).not.toHaveProperty("body");
    expect(adminSessionClientContract).toMatchObject({
      path: "/admin-auth/session",
      loginPath: "/admin-auth/login",
      logoutPath: "/admin-auth/logout",
      currentAuthenticatedStateImplemented: true,
      browserPersistence: false,
      customCredentialHeaders: false
    });
    expect(isFailClosedAdminSessionStatus(status)).toBe(true);
  });

  it("uses exact same-origin POST semantics for login and logout", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(authenticatedResponse())
      .mockResolvedValueOnce(unauthenticatedResponse("logged_out"));

    const login = await loginAdminSession({
      fetchImpl,
      username: "admin",
      password: "test-only-password"
    });
    const logout = await logoutAdminSession({ fetchImpl });

    expect(login.kind).toBe("authenticated");
    expect(logout.kind).toBe("unauthenticated");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      ADMIN_SESSION_LOGIN_PATH,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "manual"
      })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      ADMIN_SESSION_LOGOUT_PATH,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "manual"
      })
    );
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toMatch(/Authorization|Cookie|AGENT_KEY|X-Agent-Key/iu);
  });

  it("accepts only the not_configured, unauthenticated, and authenticated contract shapes", async () => {
    await expect(parseAdminSessionResponse(sentinelResponse())).resolves.toMatchObject({
      kind: "not_configured",
      message: "Admin authentication is not configured."
    });
    await expect(parseAdminSessionResponse(unauthenticatedResponse())).resolves.toMatchObject({
      kind: "unauthenticated"
    });
    await expect(parseAdminSessionResponse(authenticatedResponse())).resolves.toMatchObject({
      kind: "authenticated",
      principal: { kind: "single_admin", displayName: "Admin" }
    });

    await expect(
      parseAdminSessionResponse(
        jsonResponse({ status: "not_configured", authenticated: true, message: "signed in" }, 200)
      )
    ).resolves.toMatchObject({ kind: "invalid_response" });

    await expect(
      parseAdminSessionResponse(
        jsonResponse({ status: "not_configured", authenticated: false, message: "ok", role: "admin" })
      )
    ).resolves.toMatchObject({ kind: "invalid_response" });
    await expect(
      parseAdminSessionResponse(
        jsonResponse({
          configured: true,
          authenticated: true,
          principal: { kind: "single_admin", displayName: "Admin", email: "admin@example.test" },
          expiresAt: "2026-06-20T00:00:00.000Z"
        })
      )
    ).resolves.toMatchObject({ kind: "invalid_response" });
  });

  it("treats html, redirects, malformed JSON, network errors, and timeouts as fail-closed", async () => {
    await expect(parseAdminSessionResponse(new Response("<html>login</html>", { status: 200 }))).resolves.toMatchObject({
      kind: "invalid_response"
    });
    await expect(
      parseAdminSessionResponse(new Response("", { status: 302, headers: { Location: "/login" } }))
    ).resolves.toMatchObject({ kind: "invalid_response" });
    await expect(
      parseAdminSessionResponse(
        new Response("{not json", {
          status: ADMIN_SESSION_SENTINEL_HTTP_STATUS,
          headers: { "Content-Type": "application/json" }
        })
      )
    ).resolves.toMatchObject({ kind: "invalid_response" });
    await expect(fetchAdminSessionStatus({ fetchImpl: vi.fn<FetchLike>().mockRejectedValueOnce(new Error("down")) }))
      .resolves.toMatchObject({ kind: "auth_unavailable" });

    vi.useFakeTimers();
    const pending = fetchAdminSessionStatus({
      fetchImpl: vi.fn<FetchLike>((_input, init) => rejectWhenAborted(init?.signal)),
      timeoutMs: 10
    });
    await vi.advanceTimersByTimeAsync(10);
    await expect(pending).resolves.toMatchObject({ kind: "timeout" });
  });
});

function sentinelResponse(): Response {
  return jsonResponse(
    {
      status: "not_configured",
      authenticated: false,
      message: "Admin authentication is not configured."
    },
    ADMIN_SESSION_SENTINEL_HTTP_STATUS
  );
}

function unauthenticatedResponse(reason = "unauthenticated"): Response {
  return jsonResponse({
    configured: true,
    authenticated: false,
    reason
  });
}

function authenticatedResponse(): Response {
  return jsonResponse({
    configured: true,
    authenticated: true,
    principal: {
      kind: "single_admin",
      displayName: "Admin"
    },
    expiresAt: "2026-06-20T00:00:00.000Z",
    csrfToken
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const csrfToken = "csrf_token_value_at_least_32_characters";

function rejectWhenAborted(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  });
}
