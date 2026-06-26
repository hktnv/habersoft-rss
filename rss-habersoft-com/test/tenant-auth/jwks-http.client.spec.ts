import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { JwksHttpClient } from "../../src/tenant-auth/jwks-http.client";
import { generateTestKeyPair, jwks, runtimeConfig, tenantAuthConfig } from "./tenant-auth-test-helpers";

type TestServer = {
  readonly url: string;
  readonly close: () => Promise<void>;
};

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void
): Promise<TestServer> {
  const server: Server = createServer(handler);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }

  return {
    url: `http://127.0.0.1:${address.port}/.well-known/jwks.json`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
            return;
          }

          reject(error);
        });
      })
  };
}

describe("JwksHttpClient", () => {
  it("fetches JWKS from a local HTTP endpoint", async () => {
    const key = generateTestKeyPair("kid-a");
    const server = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(jwks([key])));
    });
    const client = new JwksHttpClient({
      ...runtimeConfig,
      tenantAuth: {
        ...tenantAuthConfig,
        jwksUrl: server.url
      }
    });

    await expect(client.fetch()).resolves.toEqual({
      ok: true,
      body: jwks([key])
    });
    await server.close();
  });

  it("separates infrastructure failures from invalid JWKS responses", async () => {
    const unavailableServer = await startServer((_request, response) => {
      response.writeHead(503, { "content-type": "application/json" });
      response.end("{}");
    });
    const invalidServer = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("not json");
    });

    const unavailableClient = new JwksHttpClient({
      ...runtimeConfig,
      tenantAuth: {
        ...tenantAuthConfig,
        jwksUrl: unavailableServer.url
      }
    });
    const invalidClient = new JwksHttpClient({
      ...runtimeConfig,
      tenantAuth: {
        ...tenantAuthConfig,
        jwksUrl: invalidServer.url
      }
    });

    await expect(unavailableClient.fetch()).resolves.toEqual({
      ok: false,
      reason: "jwks_unavailable"
    });
    await expect(invalidClient.fetch()).resolves.toEqual({
      ok: false,
      reason: "jwks_invalid"
    });
    await unavailableServer.close();
    await invalidServer.close();
  });
});
