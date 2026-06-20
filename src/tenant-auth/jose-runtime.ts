import type { CryptoKey, JWK, JWTPayload, ProtectedHeaderParameters } from "jose";

export type JoseRuntime = {
  readonly decodeProtectedHeader: (token: string | Uint8Array) => ProtectedHeaderParameters;
  readonly importJWK: (jwk: JWK, alg?: string) => Promise<CryptoKey | Uint8Array>;
  readonly jwtVerify: (
    token: string,
    key: CryptoKey | Uint8Array,
    options: {
      readonly algorithms: readonly string[];
      readonly issuer: string;
      readonly audience: string;
      readonly clockTolerance: number;
    }
  ) => Promise<{ readonly payload: JWTPayload; readonly protectedHeader: ProtectedHeaderParameters }>;
};

let loadedRuntime: Promise<JoseRuntime> | undefined;

export function loadJoseRuntime(): Promise<JoseRuntime> {
  loadedRuntime ??= importJoseRuntime();
  return loadedRuntime;
}

function importJoseRuntime(): Promise<JoseRuntime> {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- jose v6 is ESM-only; this preserves import() in CommonJS output.
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string
  ) => Promise<JoseRuntime>;

  return dynamicImport("jose");
}
