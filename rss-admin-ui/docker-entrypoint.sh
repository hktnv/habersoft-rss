#!/bin/sh
set -eu

api_base_url="${ADMIN_UI_API_BASE_URL:-http://localhost:3000}"
environment_name="${ADMIN_UI_ENVIRONMENT_NAME:-container}"

cat > /usr/share/nginx/html/env-config.js <<EOF
window.__RSS_ADMIN_UI_CONFIG__ = {
  apiBaseUrl: "${api_base_url}",
  environmentName: "${environment_name}"
};
EOF

exec nginx -g "daemon off;"
