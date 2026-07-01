#!/bin/sh
set -eu

fail() {
  printf '%s\n' "rss-admin-ui entrypoint: $1" >&2
  exit 1
}

VALIDATED_ORIGIN=""
VALIDATED_ORIGIN_REASON=""

set_origin_rejection() {
  VALIDATED_ORIGIN=""
  VALIDATED_ORIGIN_REASON="$1"
}

validate_origin() {
  name="$1"
  origin="$2"
  allow_empty="$3"

  VALIDATED_ORIGIN=""
  VALIDATED_ORIGIN_REASON=""

  if [ "$origin" = "" ]; then
    if [ "$allow_empty" = "true" ]; then
      return
    fi
    set_origin_rejection "invalid_upstream_origin"
    return
  fi

  case "$origin" in
    http://*)
      upstream_rest="${origin#http://}"
      upstream_scheme="http://"
      ;;
    https://*)
      upstream_rest="${origin#https://}"
      upstream_scheme="https://"
      ;;
    *)
      set_origin_rejection "invalid_upstream_origin"
      return
      ;;
  esac

  case "$origin" in
    *[[:space:]]*|*\"*|*\'*|*\\*|*\`*|*'$'*|*';'*|*'{'*|*'}'*|*'|'*|*'&'*|*'<'*|*'>'*)
      set_origin_rejection "invalid_upstream_origin"
      return
      ;;
  esac

  case "$upstream_rest" in
    *@*|*'?'*|*'#'*)
      set_origin_rejection "invalid_upstream_origin"
      return
      ;;
  esac

  case "$upstream_rest" in
    */)
      upstream_rest="${upstream_rest%/}"
      ;;
  esac

  case "$upstream_rest" in
    ""|*/*)
      set_origin_rejection "invalid_upstream_origin"
      return
      ;;
  esac

  upstream_host="$upstream_rest"
  case "$upstream_rest" in
    *:*)
      upstream_host="${upstream_rest%:*}"
      upstream_port="${upstream_rest##*:}"
      case "$upstream_port" in
        ""|*[!0-9]*)
          set_origin_rejection "invalid_upstream_origin"
          return
          ;;
      esac
      if [ "$upstream_port" -lt 1 ] || [ "$upstream_port" -gt 65535 ]; then
        set_origin_rejection "invalid_upstream_origin"
        return
      fi
      ;;
  esac

  if [ "$upstream_host" = "" ]; then
    set_origin_rejection "invalid_upstream_origin"
    return
  fi

  upstream_host_lc="$(printf '%s' "$upstream_host" | tr '[:upper:]' '[:lower:]')"
  upstream_host_check="$upstream_host_lc"
  case "$upstream_host_check" in
    \[*\])
      upstream_host_check="${upstream_host_check#\[}"
      upstream_host_check="${upstream_host_check%\]}"
      ;;
  esac

  case "$upstream_host_check" in
    rss.habersoft.com|rss.habersoft.com.|rss-panel.habersoft.com|rss-panel.habersoft.com.)
      # Public Habersoft edge hostnames are rejected before proxying. This keeps
      # the boundary fail-closed without crash-looping the static diagnostics.
      set_origin_rejection "public_edge_upstream_rejected"
      return
      ;;
  esac

  case "$upstream_host_check" in
    localhost|localhost.|127.*|0.0.0.0|0.0.0.0.|0|::|::1|0:0:0:0:0:0:0:0|0:0:0:0:0:0:0:1)
      # container-local or unspecified loopback host values are invalid in the
      # admin UI production Docker bridge runtime; use backend-network service DNS
      # or proven host-gateway reachability.
      set_origin_rejection "invalid_upstream_origin"
      return
      ;;
  esac

  VALIDATED_ORIGIN="${upstream_scheme}${upstream_rest}"
}

strict_origin_guard() {
  name="$1"
  reason="$2"

  if [ "$reason" = "" ]; then
    return
  fi

  if [ "${ADMIN_UI_STRICT_UPSTREAM_ORIGIN_VALIDATION:-}" = "true" ]; then
    fail "$name strict validation failed: $reason"
  fi

  printf '%s\n' "rss-admin-ui entrypoint: $name degraded: $reason" >&2
}

status_degraded_routes() {
  reason="$1"
  cat <<EOF
  location = /status-api/health/live {
    if (\$request_method != GET) {
      return 405;
    }

    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;
    return 502 '{"status":"unavailable","reason":"${reason}"}';
  }

  location = /status-api/health/ready {
    if (\$request_method != GET) {
      return 405;
    }

    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;
    return 502 '{"status":"unavailable","reason":"${reason}"}';
  }
EOF
}

status_proxy_routes() {
  origin="$1"
  cat <<EOF
  location = /status-api/health/live {
    if (\$request_method != GET) {
      return 405;
    }

    set \$status_api_upstream_origin "${origin}";
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    set \$args "";
    proxy_method GET;
    proxy_pass_request_headers off;
    proxy_pass_request_body off;
    proxy_set_header Host \$proxy_host;
    proxy_set_header Accept "application/json";
    proxy_set_header Content-Length "";
    proxy_hide_header Set-Cookie;
    proxy_hide_header WWW-Authenticate;
    proxy_hide_header Access-Control-Allow-Origin;
    proxy_hide_header Access-Control-Allow-Credentials;
    proxy_hide_header Access-Control-Allow-Headers;
    proxy_hide_header Access-Control-Allow-Methods;
    proxy_hide_header Access-Control-Expose-Headers;
    proxy_hide_header Access-Control-Max-Age;
    proxy_intercept_errors on;
    error_page 401 403 = @status_api_upstream_forbidden;
    error_page 500 502 504 = @status_api_upstream_unavailable;
    proxy_connect_timeout 2s;
    proxy_send_timeout 2s;
    proxy_read_timeout 4s;
    proxy_buffering off;
    proxy_pass \$status_api_upstream_origin/health/live?;
  }

  location = /status-api/health/ready {
    if (\$request_method != GET) {
      return 405;
    }

    set \$status_api_upstream_origin "${origin}";
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    set \$args "";
    proxy_method GET;
    proxy_pass_request_headers off;
    proxy_pass_request_body off;
    proxy_set_header Host \$proxy_host;
    proxy_set_header Accept "application/json";
    proxy_set_header Content-Length "";
    proxy_hide_header Set-Cookie;
    proxy_hide_header WWW-Authenticate;
    proxy_hide_header Access-Control-Allow-Origin;
    proxy_hide_header Access-Control-Allow-Credentials;
    proxy_hide_header Access-Control-Allow-Headers;
    proxy_hide_header Access-Control-Allow-Methods;
    proxy_hide_header Access-Control-Expose-Headers;
    proxy_hide_header Access-Control-Max-Age;
    proxy_intercept_errors on;
    error_page 401 403 = @status_api_upstream_forbidden;
    error_page 500 502 504 = @status_api_upstream_unavailable;
    proxy_connect_timeout 2s;
    proxy_send_timeout 2s;
    proxy_read_timeout 4s;
    proxy_buffering off;
    proxy_pass \$status_api_upstream_origin/health/ready?;
  }

  location @status_api_upstream_forbidden {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;
    return 502 '{"status":"unavailable","reason":"upstream_forbidden"}';
  }

  location @status_api_upstream_unavailable {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;
    return 502 '{"status":"unavailable","reason":"upstream_unavailable"}';
  }
EOF
}

auth_static_routes() {
  cat <<'EOF'
  location = /admin-auth/session {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;

    if ($request_method != GET) {
      return 405 '{"configured":false,"status":"not_configured","authenticated":false,"reason":"not_configured","message":"Admin authentication is not configured."}';
    }

    set $args "";
    return 501 '{"configured":false,"status":"not_configured","authenticated":false,"reason":"not_configured","message":"Admin authentication is not configured."}';
  }

  location = /admin-auth/login {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;

    if ($request_method != POST) {
      return 405 '{"configured":false,"status":"not_configured","authenticated":false,"reason":"not_configured","message":"Admin authentication is not configured."}';
    }

    return 503 '{"configured":false,"status":"not_configured","authenticated":false,"reason":"not_configured","message":"Admin authentication is not configured."}';
  }

  location = /admin-auth/logout {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;

    if ($request_method != POST) {
      return 405 '{"configured":false,"status":"not_configured","authenticated":false,"reason":"not_configured","message":"Admin authentication is not configured."}';
    }

    return 501 '{"configured":false,"status":"not_configured","authenticated":false,"reason":"not_configured","message":"Admin authentication is not configured."}';
  }

  location = /admin-auth {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    return 404;
  }

  location ^~ /admin-auth/ {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    return 404;
  }
EOF
}

auth_degraded_routes() {
  reason="$1"
  cat <<EOF
  location = /admin-auth/session {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;

    if (\$request_method != GET) {
      return 405 '{"configured":false,"authenticated":false,"reason":"method_not_allowed"}';
    }

    set \$args "";
    return 502 '{"configured":false,"authenticated":false,"reason":"${reason}"}';
  }

  location = /admin-auth/login {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;

    if (\$request_method != POST) {
      return 405 '{"configured":false,"authenticated":false,"reason":"method_not_allowed"}';
    }

    return 502 '{"configured":false,"authenticated":false,"reason":"${reason}"}';
  }

  location = /admin-auth/logout {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;

    if (\$request_method != POST) {
      return 405 '{"configured":false,"authenticated":false,"reason":"method_not_allowed"}';
    }

    return 502 '{"configured":false,"authenticated":false,"reason":"${reason}"}';
  }

  location = /admin-auth {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    return 404;
  }

  location ^~ /admin-auth/ {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    return 404;
  }
EOF
}

auth_proxy_routes() {
  origin="$1"
  cat <<EOF
  location = /admin-auth/session {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;

    if (\$request_method != GET) {
      return 405 '{"configured":false,"authenticated":false,"reason":"method_not_allowed"}';
    }

    set \$admin_auth_upstream_origin "${origin}";
    set \$args "";
    proxy_method GET;
    proxy_pass_request_headers off;
    proxy_pass_request_body off;
    proxy_set_header Host \$proxy_host;
    proxy_set_header Accept "application/json";
    proxy_set_header Cookie \$http_cookie;
    proxy_set_header Content-Length "";
    proxy_hide_header Set-Cookie;
    proxy_hide_header WWW-Authenticate;
    proxy_hide_header Access-Control-Allow-Origin;
    proxy_hide_header Access-Control-Allow-Credentials;
    proxy_hide_header Access-Control-Allow-Headers;
    proxy_hide_header Access-Control-Allow-Methods;
    proxy_hide_header Access-Control-Expose-Headers;
    proxy_hide_header Access-Control-Max-Age;
    proxy_intercept_errors on;
    error_page 500 502 504 = @admin_auth_unavailable;
    proxy_connect_timeout 2s;
    proxy_send_timeout 2s;
    proxy_read_timeout 4s;
    proxy_buffering off;
    proxy_pass \$admin_auth_upstream_origin/admin-auth/session?;
  }

  location = /admin-auth/login {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    client_max_body_size 4k;

    if (\$request_method != POST) {
      return 405 '{"configured":false,"authenticated":false,"reason":"method_not_allowed"}';
    }

    set \$admin_auth_upstream_origin "${origin}";
    set \$args "";
    proxy_pass_request_headers off;
    proxy_set_header Host \$proxy_host;
    proxy_set_header Accept "application/json";
    proxy_set_header Content-Type \$content_type;
    proxy_set_header Content-Length \$content_length;
    proxy_set_header Cookie \$http_cookie;
    proxy_hide_header WWW-Authenticate;
    proxy_hide_header Access-Control-Allow-Origin;
    proxy_hide_header Access-Control-Allow-Credentials;
    proxy_hide_header Access-Control-Allow-Headers;
    proxy_hide_header Access-Control-Allow-Methods;
    proxy_hide_header Access-Control-Expose-Headers;
    proxy_hide_header Access-Control-Max-Age;
    proxy_intercept_errors on;
    error_page 500 502 504 = @admin_auth_unavailable;
    proxy_connect_timeout 2s;
    proxy_send_timeout 2s;
    proxy_read_timeout 4s;
    proxy_buffering off;
    proxy_pass \$admin_auth_upstream_origin/admin-auth/login?;
  }

  location = /admin-auth/logout {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;

    if (\$request_method != POST) {
      return 405 '{"configured":false,"authenticated":false,"reason":"method_not_allowed"}';
    }

    set \$admin_auth_upstream_origin "${origin}";
    set \$args "";
    proxy_pass_request_headers off;
    proxy_set_header Host \$proxy_host;
    proxy_set_header Accept "application/json";
    proxy_set_header Content-Type \$content_type;
    proxy_set_header Content-Length \$content_length;
    proxy_set_header Cookie \$http_cookie;
    proxy_hide_header WWW-Authenticate;
    proxy_hide_header Access-Control-Allow-Origin;
    proxy_hide_header Access-Control-Allow-Credentials;
    proxy_hide_header Access-Control-Allow-Headers;
    proxy_hide_header Access-Control-Allow-Methods;
    proxy_hide_header Access-Control-Expose-Headers;
    proxy_hide_header Access-Control-Max-Age;
    proxy_intercept_errors on;
    error_page 500 502 504 = @admin_auth_unavailable;
    proxy_connect_timeout 2s;
    proxy_send_timeout 2s;
    proxy_read_timeout 4s;
    proxy_buffering off;
    proxy_pass \$admin_auth_upstream_origin/admin-auth/logout?;
  }

  location = /admin-auth {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    return 404;
  }

  location ^~ /admin-auth/ {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    return 404;
  }

  location @admin_auth_unavailable {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;
    return 502 '{"configured":false,"authenticated":false,"reason":"auth_unavailable"}';
  }
EOF
}

admin_api_static_routes() {
  cat <<'EOF'
  location = /admin-api/operations/summary {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;

    if ($request_method != GET) {
      return 405 '{"status":"method_not_allowed","reason":"read_only_endpoint"}';
    }

    set $args "";
    return 501 '{"configured":false,"authenticated":false,"reason":"not_configured","message":"Admin authentication is not configured."}';
  }

  location = /admin-api/operations/drilldown {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;

    if ($request_method != GET) {
      return 405 '{"status":"method_not_allowed","reason":"read_only_endpoint"}';
    }

    set $args "";
    return 501 '{"configured":false,"authenticated":false,"reason":"not_configured","message":"Admin authentication is not configured."}';
  }

  location = /admin-api/operations/feed-recheck-requests {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;

    if ($request_method != POST) {
      return 405 '{"status":"method_not_allowed","reason":"feed_recheck_requires_post"}';
    }

    set $args "";
    return 501 '{"status":"unavailable","reason":"not_configured","message":"Admin authentication is not configured."}';
  }

  location = /admin-api/operations/feed-onboarding-requests {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;

    if ($request_method != POST) {
      return 405 '{"status":"method_not_allowed","reason":"feed_onboarding_requires_post"}';
    }

    set $args "";
    return 501 '{"status":"unavailable","reason":"not_configured","message":"Admin authentication is not configured."}';
  }
EOF
}

admin_api_degraded_routes() {
  reason="$1"
  cat <<EOF
  location = /admin-api/operations/summary {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;

    if (\$request_method != GET) {
      return 405 '{"status":"method_not_allowed","reason":"read_only_endpoint"}';
    }

    set \$args "";
    return 502 '{"status":"unavailable","reason":"${reason}"}';
  }

  location = /admin-api/operations/drilldown {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;

    if (\$request_method != GET) {
      return 405 '{"status":"method_not_allowed","reason":"read_only_endpoint"}';
    }

    set \$args "";
    return 502 '{"status":"unavailable","reason":"${reason}"}';
  }

  location = /admin-api/operations/feed-recheck-requests {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;

    if (\$request_method != POST) {
      return 405 '{"status":"method_not_allowed","reason":"feed_recheck_requires_post"}';
    }

    set \$args "";
    return 502 '{"status":"unavailable","reason":"${reason}"}';
  }

  location = /admin-api/operations/feed-onboarding-requests {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;

    if (\$request_method != POST) {
      return 405 '{"status":"method_not_allowed","reason":"feed_onboarding_requires_post"}';
    }

    set \$args "";
    return 502 '{"status":"unavailable","reason":"${reason}"}';
  }
EOF
}

admin_api_proxy_routes() {
  origin="$1"
  cat <<EOF
  location = /admin-api/operations/summary {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;

    if (\$request_method != GET) {
      return 405 '{"status":"method_not_allowed","reason":"read_only_endpoint"}';
    }

    set \$admin_api_upstream_origin "${origin}";
    set \$args "";
    proxy_method GET;
    proxy_pass_request_headers off;
    proxy_pass_request_body off;
    proxy_set_header Host \$proxy_host;
    proxy_set_header Accept "application/json";
    proxy_set_header Cookie \$http_cookie;
    proxy_set_header Content-Length "";
    proxy_hide_header Set-Cookie;
    proxy_hide_header WWW-Authenticate;
    proxy_hide_header Access-Control-Allow-Origin;
    proxy_hide_header Access-Control-Allow-Credentials;
    proxy_hide_header Access-Control-Allow-Headers;
    proxy_hide_header Access-Control-Allow-Methods;
    proxy_hide_header Access-Control-Expose-Headers;
    proxy_hide_header Access-Control-Max-Age;
    proxy_intercept_errors on;
    error_page 401 403 = @admin_api_unauthenticated;
    error_page 500 502 504 = @admin_api_unavailable;
    proxy_connect_timeout 2s;
    proxy_send_timeout 2s;
    proxy_read_timeout 4s;
    proxy_buffering off;
    proxy_pass \$admin_api_upstream_origin/admin-api/operations/summary?;
  }

  location = /admin-api/operations/drilldown {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;

    if (\$request_method != GET) {
      return 405 '{"status":"method_not_allowed","reason":"read_only_endpoint"}';
    }

    set \$admin_api_upstream_origin "${origin}";
    set \$args "";
    proxy_method GET;
    proxy_pass_request_headers off;
    proxy_pass_request_body off;
    proxy_set_header Host \$proxy_host;
    proxy_set_header Accept "application/json";
    proxy_set_header Cookie \$http_cookie;
    proxy_set_header Content-Length "";
    proxy_hide_header Set-Cookie;
    proxy_hide_header WWW-Authenticate;
    proxy_hide_header Access-Control-Allow-Origin;
    proxy_hide_header Access-Control-Allow-Credentials;
    proxy_hide_header Access-Control-Allow-Headers;
    proxy_hide_header Access-Control-Allow-Methods;
    proxy_hide_header Access-Control-Expose-Headers;
    proxy_hide_header Access-Control-Max-Age;
    proxy_intercept_errors on;
    error_page 401 403 = @admin_api_unauthenticated;
    error_page 500 502 504 = @admin_api_unavailable;
    proxy_connect_timeout 2s;
    proxy_send_timeout 2s;
    proxy_read_timeout 4s;
    proxy_buffering off;
    proxy_pass \$admin_api_upstream_origin/admin-api/operations/drilldown?;
  }

  location = /admin-api/operations/feed-recheck-requests {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;
    client_max_body_size 2k;

    if (\$request_method != POST) {
      return 405 '{"status":"method_not_allowed","reason":"feed_recheck_requires_post"}';
    }

    set \$admin_api_upstream_origin "${origin}";
    set \$args "";
    proxy_pass_request_headers off;
    proxy_set_header Host \$proxy_host;
    proxy_set_header Accept "application/json";
    proxy_set_header Content-Type "application/json";
    proxy_set_header Content-Length \$content_length;
    proxy_set_header Cookie \$http_cookie;
    proxy_set_header X-Admin-CSRF \$http_x_admin_csrf;
    proxy_set_header X-Admin-Idempotency-Key \$http_x_admin_idempotency_key;
    proxy_hide_header Set-Cookie;
    proxy_hide_header WWW-Authenticate;
    proxy_hide_header Access-Control-Allow-Origin;
    proxy_hide_header Access-Control-Allow-Credentials;
    proxy_hide_header Access-Control-Allow-Headers;
    proxy_hide_header Access-Control-Allow-Methods;
    proxy_hide_header Access-Control-Expose-Headers;
    proxy_hide_header Access-Control-Max-Age;
    proxy_intercept_errors on;
    error_page 401 = @admin_api_unauthenticated;
    error_page 403 = @admin_api_forbidden;
    error_page 500 502 504 = @admin_api_unavailable;
    proxy_connect_timeout 2s;
    proxy_send_timeout 2s;
    proxy_read_timeout 4s;
    proxy_buffering off;
    proxy_pass \$admin_api_upstream_origin/admin-api/operations/feed-recheck-requests?;
  }

  location = /admin-api/operations/feed-onboarding-requests {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;
    client_max_body_size 4k;

    if (\$request_method != POST) {
      return 405 '{"status":"method_not_allowed","reason":"feed_onboarding_requires_post"}';
    }

    set \$admin_api_upstream_origin "${origin}";
    set \$args "";
    proxy_pass_request_headers off;
    proxy_set_header Host \$proxy_host;
    proxy_set_header Accept "application/json";
    proxy_set_header Content-Type "application/json";
    proxy_set_header Content-Length \$content_length;
    proxy_set_header Cookie \$http_cookie;
    proxy_set_header X-Admin-CSRF \$http_x_admin_csrf;
    proxy_set_header X-Admin-Idempotency-Key \$http_x_admin_idempotency_key;
    proxy_hide_header Set-Cookie;
    proxy_hide_header WWW-Authenticate;
    proxy_hide_header Access-Control-Allow-Origin;
    proxy_hide_header Access-Control-Allow-Credentials;
    proxy_hide_header Access-Control-Allow-Headers;
    proxy_hide_header Access-Control-Allow-Methods;
    proxy_hide_header Access-Control-Expose-Headers;
    proxy_hide_header Access-Control-Max-Age;
    proxy_intercept_errors on;
    error_page 401 = @admin_api_unauthenticated;
    error_page 403 = @admin_api_forbidden;
    error_page 500 502 504 = @admin_api_unavailable;
    proxy_connect_timeout 2s;
    proxy_send_timeout 2s;
    proxy_read_timeout 4s;
    proxy_buffering off;
    proxy_pass \$admin_api_upstream_origin/admin-api/operations/feed-onboarding-requests?;
  }

  location @admin_api_unauthenticated {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;
    return 401 '{"authenticated":false,"reason":"unauthenticated"}';
  }

  location @admin_api_forbidden {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;
    return 403 '{"authenticated":true,"reason":"csrf_failed"}';
  }

  location @admin_api_unavailable {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    default_type application/json;
    return 502 '{"status":"unavailable","reason":"admin_api_unavailable"}';
  }
EOF
}

health_upstream_origin="${ADMIN_UI_HEALTH_UPSTREAM_ORIGIN:-}"
auth_upstream_origin="${ADMIN_UI_AUTH_UPSTREAM_ORIGIN:-}"
environment_name="${ADMIN_UI_ENVIRONMENT_NAME:-container}"

validate_origin "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN" "$health_upstream_origin" "false"
normalized_health_upstream_origin="$VALIDATED_ORIGIN"
health_upstream_rejection="$VALIDATED_ORIGIN_REASON"
strict_origin_guard "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN" "$health_upstream_rejection"

validate_origin "ADMIN_UI_AUTH_UPSTREAM_ORIGIN" "$auth_upstream_origin" "true"
normalized_auth_upstream_origin="$VALIDATED_ORIGIN"
auth_upstream_rejection="$VALIDATED_ORIGIN_REASON"
strict_origin_guard "ADMIN_UI_AUTH_UPSTREAM_ORIGIN" "$auth_upstream_rejection"

if [ ! -z "$environment_name" ] && ! printf '%s' "$environment_name" | grep -Eq '^[A-Za-z0-9._ -]{1,64}$'; then
  fail "ADMIN_UI_ENVIRONMENT_NAME must be a non-secret label using letters, digits, spaces, dot, underscore, or hyphen"
fi

cat > /usr/share/nginx/html/env-config.js <<EOF
window.__RSS_ADMIN_UI_CONFIG__ = {
  environmentName: "${environment_name}"
};
EOF

if [ "$health_upstream_rejection" = "" ]; then
  status_routes="$(status_proxy_routes "$normalized_health_upstream_origin")"
else
  status_routes="$(status_degraded_routes "$health_upstream_rejection")"
fi

if [ "$auth_upstream_rejection" != "" ]; then
  auth_routes="$(auth_degraded_routes "$auth_upstream_rejection")"
  admin_api_routes="$(admin_api_degraded_routes "$auth_upstream_rejection")"
elif [ "$normalized_auth_upstream_origin" = "" ]; then
  auth_routes="$(auth_static_routes)"
  admin_api_routes="$(admin_api_static_routes)"
else
  auth_routes="$(auth_proxy_routes "$normalized_auth_upstream_origin")"
  admin_api_routes="$(admin_api_proxy_routes "$normalized_auth_upstream_origin")"
fi

awk -v auth_block="$auth_routes" -v admin_api_block="$admin_api_routes" -v status_block="$status_routes" '
  /__ADMIN_UI_AUTH_ROUTES__/ {
    print auth_block
    next
  }
  /__ADMIN_UI_ADMIN_API_ROUTES__/ {
    print admin_api_block
    next
  }
  /__ADMIN_UI_STATUS_ROUTES__/ {
    print status_block
    next
  }
  { print }
' /tmp/nginx/templates/default.conf.template > /tmp/nginx/conf.d/default.conf

if grep -Eq '__ADMIN_UI_[A-Z0-9_]+__' /tmp/nginx/conf.d/default.conf; then
  fail "generated Nginx config contains unresolved admin UI template markers"
fi

if ! grep -Fq 'location = /admin-api/operations/summary' /tmp/nginx/conf.d/default.conf; then
  fail "generated Nginx config is missing /admin-api/operations/summary"
fi

if ! grep -Fq 'location = /admin-api/operations/drilldown' /tmp/nginx/conf.d/default.conf; then
  fail "generated Nginx config is missing /admin-api/operations/drilldown"
fi

if ! grep -Fq 'location = /admin-api/operations/feed-recheck-requests' /tmp/nginx/conf.d/default.conf; then
  fail "generated Nginx config is missing /admin-api/operations/feed-recheck-requests"
fi

if ! grep -Fq 'location = /admin-api/operations/feed-onboarding-requests' /tmp/nginx/conf.d/default.conf; then
  fail "generated Nginx config is missing /admin-api/operations/feed-onboarding-requests"
fi

if ! grep -Fq 'location = /admin-api' /tmp/nginx/conf.d/default.conf || ! grep -Fq 'location ^~ /admin-api/' /tmp/nginx/conf.d/default.conf; then
  fail "generated Nginx config is missing admin-api fallback rejection routes"
fi

nginx -t

exec nginx -g "daemon off;"
