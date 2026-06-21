const releasePattern = /^[0-9]+\.[0-9]+\.[0-9]+-ms-[0-9]+-[a-f0-9]{40}$/u;

export function releaseId(version, sourceCommit) {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+-ms-[0-9]+$/u.test(version)) {
    throw new Error("release version is invalid");
  }
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit)) {
    throw new Error("source commit must be a full lowercase git SHA-1");
  }
  return `${version}-${sourceCommit}`;
}

export function releaseDir(remoteBaseDir, version, sourceCommit) {
  const id = releaseId(version, sourceCommit);
  return joinPosix(remoteBaseDir, "releases", id);
}

export function assertPathInsideBase(remoteBaseDir, targetPath) {
  const base = normalize(remoteBaseDir);
  const target = normalize(targetPath);
  if (target !== base && !target.startsWith(`${base}/`)) {
    throw new Error("remote path escapes base directory");
  }
  if (target.includes("/../") || target.endsWith("/..")) {
    throw new Error("remote path contains traversal");
  }
}

export function assertReleaseTarget(remoteBaseDir, targetPath) {
  assertPathInsideBase(remoteBaseDir, targetPath);
  const relative = normalize(targetPath).slice(normalize(remoteBaseDir).length + 1);
  if (!relative.startsWith("releases/") || !releasePattern.test(relative.slice("releases/".length))) {
    throw new Error("release target must be a release directory under base");
  }
}

export function assertNoVolumeDeletion(commands) {
  const text = Array.isArray(commands) ? commands.join("\n") : String(commands);
  if (/down\s+-v|--volumes|volume\s+rm|system\s+prune|redis-cli\s+flush/iu.test(text)) {
    throw new Error("staging command must not delete volumes or flush Redis");
  }
}

export function switchCommands(remoteBaseDir, nextReleaseDir) {
  assertReleaseTarget(remoteBaseDir, nextReleaseDir);
  const currentLink = joinPosix(remoteBaseDir, "current");
  const previousLink = joinPosix(remoteBaseDir, "previous");
  return [
    `if [ -L ${q(currentLink)} ]; then cp -P ${q(currentLink)} ${q(previousLink)}; fi`,
    `ln -sfn ${q(nextReleaseDir)} ${q(`${currentLink}.next`)}`,
    `mv -Tf ${q(`${currentLink}.next`)} ${q(currentLink)}`
  ];
}

function joinPosix(...parts) {
  return normalize(parts.join("/"));
}

function normalize(value) {
  return String(value).replaceAll("\\", "/").replace(/\/+/gu, "/").replace(/\/$/u, "") || "/";
}

function q(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
