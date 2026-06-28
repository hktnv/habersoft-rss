import type { ClientRequest, IncomingMessage, ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import type { Plugin, ProxyOptions, ViteDevServer } from "vite";
import { defineConfig } from "vite";
import { normalizeHealthUpstreamOrigin } from "./scripts/health-upstream-origin.mjs";

const statusApiRoutes = new Set(["/status-api/health/live", "/status-api/health/ready"]);
const sensitiveRequestHeaders = ["authorization", "cookie", "proxy-authorization", "x-agent-key"];

export default defineConfig(({ command }) => {
  const healthProxyTarget =
    command === "serve" ? normalizeHealthUpstreamOrigin(process.env.ADMIN_UI_HEALTH_UPSTREAM_ORIGIN) : undefined;

  return {
    plugins: [statusApiRouteGuard(), react()],
    server: {
      host: "127.0.0.1",
      port: 5174,
      ...(healthProxyTarget === undefined
        ? {}
        : {
            proxy: {
              "/status-api/health/live": healthProxy(healthProxyTarget, "/health/live"),
              "/status-api/health/ready": healthProxy(healthProxyTarget, "/health/ready")
            }
          })
    },
    preview: {
      host: "127.0.0.1",
      port: 4173
    }
  };
});

function statusApiRouteGuard(): Plugin {
  return {
    name: "status-api-route-guard",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((request: IncomingMessage, response: ServerResponse, next: () => void) => {
        const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
        if (statusApiRoutes.has(pathname) && request.method !== "GET") {
          response.statusCode = 405;
          response.setHeader("Cache-Control", "no-store");
          response.end("Method Not Allowed");
          return;
        }

        if (pathname.startsWith("/status-api/") && !statusApiRoutes.has(pathname)) {
          response.statusCode = 404;
          response.setHeader("Cache-Control", "no-store");
          response.end("Not Found");
          return;
        }

        next();
      });
    }
  };
}

function healthProxy(target: string, upstreamPath: "/health/live" | "/health/ready"): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    secure: true,
    rewrite: () => upstreamPath,
    configure(proxy) {
      proxy.on("proxyReq", (proxyRequest: ClientRequest) => {
        for (const header of sensitiveRequestHeaders) {
          proxyRequest.removeHeader(header);
        }
        for (const header of Object.keys(proxyRequest.getHeaders())) {
          if (/credential|token|key/iu.test(header)) {
            proxyRequest.removeHeader(header);
          }
        }
        proxyRequest.removeHeader("content-length");
        proxyRequest.setHeader("accept", "application/json");
      });
    }
  };
}
