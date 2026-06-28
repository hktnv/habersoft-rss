#!/bin/sh
set -eu

fail() {
  printf '%s\n' "rss-admin-ui entrypoint: $1" >&2
  exit 1
}

health_upstream_origin="${ADMIN_UI_HEALTH_UPSTREAM_ORIGIN:-}"
environment_name="${ADMIN_UI_ENVIRONMENT_NAME:-container}"

case "$health_upstream_origin" in
  http://*)
    upstream_rest="${health_upstream_origin#http://}"
    upstream_scheme="http://"
    ;;
  https://*)
    upstream_rest="${health_upstream_origin#https://}"
    upstream_scheme="https://"
    ;;
  *)
    fail "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN must be an absolute http(s) origin"
    ;;
esac

case "$health_upstream_origin" in
  *[[:space:]]*|*\"*|*\'*|*\\*|*\`*|*'$'*|*';'*|*'{'*|*'}'*|*'|'*|*'&'*|*'<'*|*'>'*)
    fail "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN contains unsafe characters"
    ;;
esac

case "$upstream_rest" in
  *@*|*'?'*|*'#'*)
    fail "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN must not include userinfo, query, or fragment"
    ;;
esac

case "$upstream_rest" in
  */)
    upstream_rest="${upstream_rest%/}"
    ;;
esac

case "$upstream_rest" in
  ""|*/*)
    fail "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN must be an origin without a path"
    ;;
esac

upstream_host="$upstream_rest"
case "$upstream_rest" in
  *:*)
    upstream_host="${upstream_rest%:*}"
    upstream_port="${upstream_rest##*:}"
    case "$upstream_port" in
      ""|*[!0-9]*)
        fail "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN port must be numeric"
        ;;
    esac
    if [ "$upstream_port" -lt 1 ] || [ "$upstream_port" -gt 65535 ]; then
      fail "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN port must be between 1 and 65535"
    fi
    ;;
esac

if [ "$upstream_host" = "" ]; then
  fail "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN must include a host"
fi

if ! printf '%s' "$environment_name" | grep -Eq '^[A-Za-z0-9._ -]{1,64}$'; then
  fail "ADMIN_UI_ENVIRONMENT_NAME must be a non-secret label using letters, digits, spaces, dot, underscore, or hyphen"
fi

normalized_health_upstream_origin="${upstream_scheme}${upstream_rest}"

cat > /usr/share/nginx/html/env-config.js <<EOF
window.__RSS_ADMIN_UI_CONFIG__ = {
  environmentName: "${environment_name}"
};
EOF

sed "s#__ADMIN_UI_HEALTH_UPSTREAM_ORIGIN__#${normalized_health_upstream_origin}#g" \
  /tmp/nginx/templates/default.conf.template > /tmp/nginx/conf.d/default.conf

nginx -t

exec nginx -g "daemon off;"
