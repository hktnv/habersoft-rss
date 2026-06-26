FROM node:24-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
ARG VITE_API_BASE_URL=http://localhost:3000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM nginx:1.29-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.sh

RUN addgroup -S appgroup \
  && adduser -S appuser -G appgroup \
  && chmod +x /docker-entrypoint.sh \
  && sed -i 's#pid[[:space:]]*/run/nginx.pid;#pid /tmp/nginx.pid;#' /etc/nginx/nginx.conf \
  && mkdir -p /var/cache/nginx /var/run/nginx /tmp/nginx \
  && chown -R appuser:appgroup /usr/share/nginx/html /var/cache/nginx /var/run/nginx /tmp/nginx /docker-entrypoint.sh

USER appuser
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
