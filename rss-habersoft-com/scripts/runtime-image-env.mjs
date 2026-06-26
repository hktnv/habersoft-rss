import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const RUNTIME_IMAGE_ENV_PATH = "deploy/runtime-image.env";
export const RUNTIME_IMAGE_ENV_KEY = "MAIN_SERVICE_IMAGE";

export function isImmutableImageId(value) {
  return /^sha256:[a-f0-9]{64}$/u.test(String(value ?? ""));
}

export function formatRuntimeImageEnv(imageId) {
  if (!isImmutableImageId(imageId)) {
    throw new Error("runtime image identity must be sha256:<64-hex>");
  }
  return `${RUNTIME_IMAGE_ENV_KEY}=${imageId}\n`;
}

export function parseRuntimeImageEnvText(text) {
  const entries = String(text)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  if (entries.length !== 1) {
    throw new Error("runtime-image.env must contain exactly one key");
  }
  const [line] = entries;
  const separator = line.indexOf("=");
  if (separator <= 0) {
    throw new Error("runtime-image.env line is invalid");
  }
  const key = line.slice(0, separator);
  const value = line.slice(separator + 1);
  if (key !== RUNTIME_IMAGE_ENV_KEY) {
    throw new Error("runtime-image.env key mismatch");
  }
  if (!isImmutableImageId(value)) {
    throw new Error("runtime-image.env value must be an immutable image id");
  }
  return { key, imageId: value };
}

export function loadRuntimeImageEnv(packageDir) {
  const file = path.join(path.resolve(packageDir), RUNTIME_IMAGE_ENV_PATH);
  const text = readFileSync(file, "utf8");
  return {
    path: RUNTIME_IMAGE_ENV_PATH,
    sha256: sha256(text),
    ...parseRuntimeImageEnvText(text)
  };
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
