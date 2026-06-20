import type { TenantPrincipal } from "./tenant-auth.types";

export function createTenantPrincipal(input: {
  readonly subject: string;
  readonly scopes: readonly string[];
  readonly tokenId?: string;
}): TenantPrincipal {
  const principal: TenantPrincipal = {
    siteClientId: input.subject,
    subject: input.subject,
    scopes: createReadonlyScopeSet(input.scopes),
    ...(input.tokenId === undefined ? {} : { tokenId: input.tokenId })
  };

  return Object.freeze(principal);
}

function createReadonlyScopeSet(scopes: readonly string[]): ReadonlySet<string> {
  const values = new Set(scopes);
  const readonlySet: ReadonlySet<string> = {
    get size() {
      return values.size;
    },
    has(value: string) {
      return values.has(value);
    },
    forEach(callback, thisArg) {
      values.forEach((value) => {
        callback.call(thisArg, value, value, readonlySet);
      });
    },
    entries() {
      return values.entries();
    },
    keys() {
      return values.keys();
    },
    values() {
      return values.values();
    },
    [Symbol.iterator]() {
      return values[Symbol.iterator]();
    }
  };

  return Object.freeze(readonlySet);
}
