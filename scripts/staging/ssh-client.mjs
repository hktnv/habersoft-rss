import { spawnSync } from "node:child_process";

export function buildSshArgs(target, remoteCommand) {
  return [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${target.known_hosts_file}`,
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ServerAliveInterval=10",
    "-o",
    "ServerAliveCountMax=3",
    "-p",
    String(target.ssh_port),
    `${target.ssh_user}@${target.ssh_host}`,
    remoteCommand
  ];
}

export function buildScpArgs(target, source, destination) {
  return [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${target.known_hosts_file}`,
    "-o",
    "ConnectTimeout=10",
    "-P",
    String(target.ssh_port),
    source,
    `${target.ssh_user}@${target.ssh_host}:${destination}`
  ];
}

export function assertNoInsecureSshArgs(args) {
  const joined = args.join(" ");
  if (/StrictHostKeyChecking=no|sshpass|password=/iu.test(joined)) {
    throw new Error("insecure SSH option detected");
  }
  if (!joined.includes("BatchMode=yes") || !joined.includes("StrictHostKeyChecking=yes")) {
    throw new Error("strict SSH options are required");
  }
}

export function posixSingleQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function redact(text) {
  return String(text)
    .replace(/Bearer [A-Za-z0-9._-]+/gu, "Bearer [REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/giu, "postgresql://[REDACTED]")
    .replace(/(PASSWORD|SECRET|TOKEN|AGENT_KEY)=([^\s]+)/giu, "$1=[REDACTED]");
}

export function runSsh(target, remoteCommand) {
  const args = buildSshArgs(target, remoteCommand);
  assertNoInsecureSshArgs(args);
  const result = spawnSync("ssh", args, { encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stdout: redact(result.stdout ?? ""),
    stderr: redact(result.stderr ?? "")
  };
}
