import { startLocalJwksFixture } from "./local-jwks-fixture/local-jwks-fixture-entrypoint";

startLocalJwksFixture().catch((error: unknown) => {
  console.error("local JWKS fixture failed to start", error);
  process.exit(1);
});
