#!/bin/sh
set -eu

fail() {
  printf '%s\n' "rss-admin-ui entrypoint: $1" >&2
  exit 1
}

validate_origin() {
  name="$1"
  origin="$2"
  allow_empty="$3"

  if [ "$origin" = "" ] && [ "$allow_empty" = "true" ]; then
    printf '%s' ""
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
      fail "$name must be an absolute http(s) origin"
      ;;
  esac

  case "$origin" in
    *[[:space:]]*|*\"*|*\'*|*\\*|*\`*|*'$'*|*';'*|*'{'*|*'}'*|*'|'*|*'&'*|*'<'*|*'>'*)
      fail "$name contains unsafe characters"
      ;;
  esac

  case "$upstream_rest" in
    *@*|*'?'*|*'#'*)
      fail "$name must not include userinfo, query, or fragment"
      ;;
  esac

  case "$upstream_rest" in
    */)
      upstream_rest="${upstream_rest%/}"
      ;;
  esac

  case "$upstream_rest" in
    ""|*/*)
      fail "$name must be an origin without a path"
      ;;
  esac

  upstream_host="$upstream_rest"
  case "$upstream_rest" in
    *:*)
      upstream_host="${upstream_rest%:*}"
      upstream_port="${upstream_rest##*:}"
      case "$upstream_port" in
        ""|*[!0-9]*)
          fail "$name port must be numeric"
          ;;
      esac
      if [ "$upstream_port" -lt 1 ] || [ "$upstream_port" -gt 65535 ]; then
        fail "$name port must be between 1 and 65535"
      fi
      ;;
  esac

  if [ "$upstream_host" = "" ]; then
    fail "$name must include a host"
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
      fail "$name must be an internal backend origin reachable from the admin UI proxy runtime, not a public Habersoft edge hostname"
      ;;
  esac

  case "$upstream_host_check" in
    localhost|localhost.|127.*|0.0.0.0|0.0.0.0.|0|::|::1|0:0:0:0:0:0:0:0|0:0:0:0:0:0:0:1)
      fail "$name must not use a container-local or unspecified loopback host in the admin UI production Docker bridge runtime; use backend-network service DNS or proven host-gateway reachability"
      ;;
  esac

  printf '%s' "${upstream_scheme}${upstream_rest}"
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

auth_proxy_routes() {
  origin="$1"
  cat <<EOF
  location = /admin-auth/session {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;

    if (\$request_method != GET) {
      return 405 '{"configured":false,"authenticated":false,"reason":"method_not_allowed"}';
    }

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
    proxy_intercept_errors on;
    error_page 500 502 504 = @admin_auth_unavailable;
    proxy_connect_timeout 2s;
    proxy_send_timeout 2s;
    proxy_read_timeout 4s;
    proxy_buffering off;
    proxy_pass ${origin}/admin-auth/session?;
  }

  location = /admin-auth/login {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    client_max_body_size 4k;

    if (\$request_method != POST) {
      return 405 '{"configured":false,"authenticated":false,"reason":"method_not_allowed"}';
    }

    set \$args "";
    proxy_pass_request_headers off;
    proxy_set_header Host \$proxy_host;
    proxy_set_header Accept "application/json";
    proxy_set_header Content-Type \$content_type;
    proxy_set_header Content-Length \$content_length;
    proxy_set_header Cookie \$http_cookie;
    proxy_hide_header WWW-Authenticate;
    proxy_intercept_errors on;
    error_page 500 502 504 = @admin_auth_unavailable;
    proxy_connect_timeout 2s;
    proxy_send_timeout 2s;
    proxy_read_timeout 4s;
    proxy_buffering off;
    proxy_pass ${origin}/admin-auth/login?;
  }

  location = /admin-auth/logout {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;

    if (\$request_method != POST) {
      return 405 '{"configured":false,"authenticated":false,"reason":"method_not_allowed"}';
    }

    set \$args "";
    proxy_pass_request_headers off;
    proxy_set_header Host \$proxy_host;
    proxy_set_header Accept "application/json";
    proxy_set_header Content-Type \$content_type;
    proxy_set_header Content-Length \$content_length;
    proxy_set_header Cookie \$http_cookie;
    proxy_hide_header WWW-Authenticate;
    proxy_intercept_errors on;
    error_page 500 502 504 = @admin_auth_unavailable;
    proxy_connect_timeout 2s;
    proxy_send_timeout 2s;
    proxy_read_timeout 4s;
    proxy_buffering off;
    proxy_pass ${origin}/admin-auth/logout?;
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

health_upstream_origin="${ADMIN_UI_HEALTH_UPSTREAM_ORIGIN:-}"
auth_upstream_origin="${ADMIN_UI_AUTH_UPSTREAM_ORIGIN:-}"
environment_name="${ADMIN_UI_ENVIRONMENT_NAME:-container}"

normalized_health_upstream_origin="$(validate_origin "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN" "$health_upstream_origin" "false")"
normalized_auth_upstream_origin="$(validate_origin "ADMIN_UI_AUTH_UPSTREAM_ORIGIN" "$auth_upstream_origin" "true")"

if [ ! -z "$environment_name" ] && ! printf '%s' "$environment_name" | grep -Eq '^[A-Za-z0-9._ -]{1,64}$'; then
  fail "ADMIN_UI_ENVIRONMENT_NAME must be a non-secret label using letters, digits, spaces, dot, underscore, or hyphen"
fi

cat > /usr/share/nginx/html/env-config.js <<EOF
window.__RSS_ADMIN_UI_CONFIG__ = {
  environmentName: "${environment_name}"
};
EOF

if [ "$normalized_auth_upstream_origin" = "" ]; then
  auth_routes="$(auth_static_routes)"
else
  auth_routes="$(auth_proxy_routes "$normalized_auth_upstream_origin")"
fi

sed "s#__ADMIN_UI_HEALTH_UPSTREAM_ORIGIN__#${normalized_health_upstream_origin}#g" \
  /tmp/nginx/templates/default.conf.template > /tmp/nginx/conf.d/default.conf.tmp

awk -v block="$auth_routes" '
  /__ADMIN_UI_AUTH_ROUTES__/ {
    print block
    next
  }
  { print }
' /tmp/nginx/conf.d/default.conf.tmp > /tmp/nginx/conf.d/default.conf

rm /tmp/nginx/conf.d/default.conf.tmp

nginx -t

exec nginx -g "daemon off;"
