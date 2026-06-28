const UNSAFE_ORIGIN_TEXT = /[\u0000-\u001F\u007F\s"'`$\\;{}|&<>]/u;

export const HEALTH_UPSTREAM_ENV_NAME = "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN";

export function normalizeHealthUpstreamOrigin(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${HEALTH_UPSTREAM_ENV_NAME} is required`);
  }

  const trimmed = value.trim();
  if (UNSAFE_ORIGIN_TEXT.test(trimmed)) {
    throw new Error(`${HEALTH_UPSTREAM_ENV_NAME} contains unsafe characters`);
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${HEALTH_UPSTREAM_ENV_NAME} must be an absolute HTTP(S) origin`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${HEALTH_UPSTREAM_ENV_NAME} must use http or https`);
  }

  if (parsed.hostname === "") {
    throw new Error(`${HEALTH_UPSTREAM_ENV_NAME} must include a host`);
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error(`${HEALTH_UPSTREAM_ENV_NAME} must not include userinfo`);
  }

  if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error(`${HEALTH_UPSTREAM_ENV_NAME} must not include path, query, or fragment`);
  }

  return parsed.origin;
}
