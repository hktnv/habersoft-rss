FROM node:24-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.29-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /tmp/nginx/templates/default.conf.template
COPY docker-entrypoint.sh /docker-entrypoint.sh

RUN addgroup -S appgroup \
  && adduser -S appuser -G appgroup \
  && chmod +x /docker-entrypoint.sh \
  && sed -i 's#pid[[:space:]]*/run/nginx.pid;#pid /tmp/nginx.pid;#' /etc/nginx/nginx.conf \
  && sed -i 's#include /etc/nginx/conf.d/\*.conf;#include /tmp/nginx/conf.d/*.conf;#' /etc/nginx/nginx.conf \
  && mkdir -p /var/cache/nginx /var/run/nginx /tmp/nginx/conf.d /tmp/nginx/templates \
  && chown -R appuser:appgroup /usr/share/nginx/html /var/cache/nginx /var/run/nginx /tmp/nginx /docker-entrypoint.sh

USER appuser
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
