import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const failures = [];

requireFile("dist/index.html");
requireFile("dist/env-config.js");

const assets = collectFiles(dist);
if (!assets.some((file) => file.endsWith(".js"))) failures.push("production build has no JavaScript asset");
if (!assets.some((file) => file.endsWith(".css"))) failures.push("production build has no CSS asset");

const forbidden = [/AGENT_KEY\s*=/u, /X-Agent-Key/iu, /C:\\Users\\EVO-MRDM/iu, /habersoft-auth\\rss-habersoft-com/iu, /PRIVATE_KEY/iu];
for (const file of assets) {
  if (!/\.(html|js|css|json)$/iu.test(file)) continue;
  const text = readFileSync(file, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      failures.push(`forbidden string in build output: ${path.relative(root, file)}`);
      break;
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`verify-build: ${failure}`);
  process.exit(1);
}

console.log("verify-build: ok");

function requireFile(relative) {
  const file = path.join(root, relative);
  if (!existsSync(file) || !statSync(file).isFile()) failures.push(`missing file: ${relative}`);
}

function collectFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(absolute);
    return entry.isFile() ? [absolute] : [];
  });
}
