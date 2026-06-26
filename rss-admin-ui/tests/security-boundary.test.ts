import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scannedEntries = ["src", "public", "index.html", "Dockerfile", "docker-entrypoint.sh", "nginx.conf"];
const sourceFiles = scannedEntries.flatMap((entry) => collectFiles(path.join(root, entry)));
const workstationPathPattern = new RegExp(String.raw`C:\\Users\\EVO-MRDM`, "iu");
const oldWorkspacePattern = new RegExp(["habersoft-auth", String.raw`\\`, "rss-habersoft-com"].join(""), "iu");

describe("frontend security boundary", () => {
  it("does not include credentials, browser persistence, writes, or private-host strings in source", () => {
    const forbidden = [
      /AGENT_KEY\s*=/u,
      /X-Agent-Key/iu,
      /Authorization\s*:/iu,
      /Cookie\s*:/iu,
      /\b(localStorage|sessionStorage|indexedDB|cookieStore)\b/u,
      /document\.cookie/u,
      /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/iu,
      /credentials:\s*["'](?:include|same-origin)["']/iu,
      workstationPathPattern,
      oldWorkspacePattern
    ];
    const offenders = [];
    for (const file of sourceFiles) {
      if (!/\.(ts|tsx|js|mjs|css|html|md|json|yaml|yml|conf|sh)$/iu.test(file)) continue;
      const text = readFileSync(file, "utf8");
      if (forbidden.some((pattern) => pattern.test(text))) offenders.push(path.relative(root, file));
    }

    expect(offenders).toEqual([]);
  });
});

function collectFiles(directory: string): string[] {
  if (statIsFile(directory)) return [directory];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(absolute);
    return entry.isFile() ? [absolute] : [];
  });
}

function statIsFile(file: string): boolean {
  try {
    return readFileSync(file).byteLength >= 0 && !file.endsWith(path.sep);
  } catch {
    return false;
  }
}
