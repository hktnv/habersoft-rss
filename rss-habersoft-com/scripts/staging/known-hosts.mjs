import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const supportedKeyTypes = new Set([
  "ssh-ed25519",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "rsa-sha2-256",
  "rsa-sha2-512",
  "ssh-rsa"
]);

export function inspectKnownHostsForTarget(target) {
  const knownHostsFile = path.resolve(target.known_hosts_file);
  validateKnownHostsFile(knownHostsFile);
  const lookups = target.ssh_port === 22 ? [target.ssh_host, `[${target.ssh_host}]:22`] : [`[${target.ssh_host}]:${target.ssh_port}`];
  const found = firstKnownHostsMatch(lookups, knownHostsFile);
  if (found.status !== 0 || found.stdout.trim() === "") {
    throw new Error("known_hosts entry for target host/port was not found");
  }

  const entries = found.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  if (entries.length === 0) {
    throw new Error("known_hosts entry for target host/port was not found");
  }

  const parsed = parseKnownHostsLine(entries[0]);
  const fingerprint = fingerprintForKnownHostsEntry(parsed.keyType, parsed.publicKey);

  return {
    target_alias: target.target_alias,
    entry_found: true,
    key_type: normalizeDisplayKeyType(parsed.keyType),
    fingerprint,
    trust_source: "operator-provided-known-hosts",
    network_contacted: false
  };
}

export function validateKnownHostsFile(file) {
  if (!existsSync(file)) {
    throw new Error("known_hosts file must exist");
  }
  const stat = statSync(file);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error("known_hosts file must be a non-empty file");
  }
  const lines = readFileSync(file, "utf8").split(/\r?\n/u);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    try {
      parseKnownHostsLine(line);
    } catch (error) {
      throw new Error(`malformed known_hosts line ${index + 1}: ${error.message}`);
    }
  }
}

function parseKnownHostsLine(line) {
  const fields = line.split(/\s+/u);
  const markerOffset = fields[0]?.startsWith("@") ? 1 : 0;
  if (fields[0] === "@revoked") {
    throw new Error("revoked host key marker is not acceptable");
  }
  if (fields.length < markerOffset + 3) {
    throw new Error("expected hostnames, key type and key");
  }
  const hostNames = fields[markerOffset];
  const keyType = fields[markerOffset + 1];
  const publicKey = fields[markerOffset + 2];
  if (hostNames === "" || hostNames.includes(" ")) {
    throw new Error("hostnames field is invalid");
  }
  if (!supportedKeyTypes.has(keyType)) {
    throw new Error(`unsupported key type ${keyType}`);
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(publicKey)) {
    throw new Error("public key is not base64");
  }
  return { hostNames, keyType, publicKey };
}

function firstKnownHostsMatch(lookups, knownHostsFile) {
  let lastResult = { status: 1, stdout: "", stderr: "" };
  for (const lookup of lookups) {
    lastResult = runSshKeygen(["-F", lookup, "-f", knownHostsFile]);
    if (lastResult.status === 0 && lastResult.stdout.trim() !== "") {
      return lastResult;
    }
  }
  return lastResult;
}

function fingerprintForKnownHostsEntry(keyType, publicKey) {
  const temp = mkdtempSync(path.join(os.tmpdir(), "main-service-known-hosts-"));
  const publicKeyFile = path.join(temp, "hostkey.pub");
  try {
    writeFileSync(publicKeyFile, `${keyType} ${publicKey}\n`, { mode: 0o600 });
    const result = runSshKeygen(["-l", "-E", "sha256", "-f", publicKeyFile]);
    if (result.status !== 0) {
      throw new Error("ssh-keygen could not fingerprint known_hosts entry");
    }
    const parts = result.stdout.trim().split(/\s+/u);
    const fingerprint = parts.find((part) => part.startsWith("SHA256:"));
    if (fingerprint === undefined) {
      throw new Error("ssh-keygen fingerprint output did not include SHA256 fingerprint");
    }
    return fingerprint;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function runSshKeygen(args) {
  const result = spawnSync("ssh-keygen", args, {
    encoding: "utf8",
    shell: false
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function normalizeDisplayKeyType(keyType) {
  if (keyType === "ssh-ed25519") {
    return "ED25519";
  }
  if (keyType === "ssh-rsa" || keyType.startsWith("rsa-")) {
    return "RSA";
  }
  if (keyType.startsWith("ecdsa-")) {
    return "ECDSA";
  }
  return keyType;
}
