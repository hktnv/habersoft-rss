import { createServer } from "node:http";
import { generateKeyPair } from "node:crypto";
import { promisify } from "node:util";
import type { JsonWebKey } from "node:crypto";

const generateKeyPairAsync = promisify(generateKeyPair);

type FixtureJwk = JsonWebKey & {
  readonly kid: string;
  readonly use: "sig";
  readonly alg: "RS256";
};

async function createFixtureJwks(): Promise<{ readonly keys: readonly FixtureJwk[] }> {
  const { publicKey } = await generateKeyPairAsync("rsa", {
    modulusLength: 2048,
    publicExponent: 0x10001
  });

  return {
    keys: [
      {
        ...publicKey.export({ format: "jwk" }),
        kid: `local-fixture-${Date.now()}`,
        use: "sig",
        alg: "RS256"
      }
    ]
  };
}

export async function startLocalJwksFixture(): Promise<void> {
  const port = Number(process.env.LOCAL_JWKS_FIXTURE_PORT ?? "3080");
  const jwks = await createFixtureJwks();

  const server = createServer((request, response) => {
    if (request.url === "/health/live") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "live" }));
      return;
    }

    if (request.url === "/.well-known/jwks.json") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(jwks));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "not_found" }));
  });

  await new Promise<void>((resolve) => {
    server.listen(port, "0.0.0.0", resolve);
  });

  console.info(`local JWKS fixture listening on ${port}`);
}
