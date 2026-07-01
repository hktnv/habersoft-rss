import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = path.join("deploy", "production", "compose.yaml");
const backendNetworkFile = path.join("deploy", "production", "compose.backend-network.yaml");
const envFile = ".env.production";
const command = process.argv[2] ?? "diagnose";
const rawPassthrough = process.argv.slice(3);
const dryRun = rawPassthrough.includes("--dry-run") || process.env.ADMIN_UI_COMPOSE_OPS_DRY_RUN === "true";
const passthrough = rawPassthrough.filter((arg) => arg !== "--dry-run");
const credentialCliPattern = /^--(?:username|password)(?:=|$)/u;

if (rawPassthrough.some((arg) => credentialCliPattern.test(arg))) {
  fail("credentials must not be supplied on compose helper command lines");
}

const envFilePath = path.join(frontendRoot, envFile);
const envFilePresent = existsSync(envFilePath);
const envFileValues = envFilePresent ? parseEnvFile(envFilePath) : {};
const effectiveEnv = relevantEnv(envFileValues);
const serviceDnsUpstreams = serviceDnsUpstreamNames(effectiveEnv);
const backendNetworkConfigured = isUsableBackendNetwork(effectiveEnv.ADMIN_UI_BACKEND_DOCKER_NETWORK);
const runtimeOverlayRequired = backendNetworkConfigured || serviceDnsUpstreams.length > 0;
const runtimeOverlayBlocked = serviceDnsUpstreams.length > 0 && !backendNetworkConfigured;

switch (command) {
  case "ps":
    printCommandSummary(command, composeBaseArgs(false));
    runCompose([...composeBaseArgs(false), "ps", ...passthrough]);
    break;
  case "logs":
    printCommandSummary(command, composeBaseArgs(false));
    runCompose([...composeBaseArgs(false), "logs", "--tail=120", ...(passthrough.length > 0 ? passthrough : ["rss-admin-ui"])]);
    break;
  case "config":
    requireRuntimePreflight(command);
    printCommandSummary(command, composeBaseArgs(true));
    if (!dryRun) runCompose([...composeBaseArgs(true), "config", ...passthrough]);
    break;
  case "up":
    requireRuntimePreflight(command);
    printCommandSummary(command, composeBaseArgs(true));
    if (!dryRun) runCompose([...composeBaseArgs(true), "up", "-d", "--no-build", "--pull", "never", ...passthrough]);
    break;
  case "recreate":
    requireRuntimePreflight(command);
    printCommandSummary(command, composeBaseArgs(true));
    if (!dryRun) {
      runCompose([
        ...composeBaseArgs(true),
        "up",
        "-d",
        "--no-build",
        "--pull",
        "never",
        "--force-recreate",
        ...(passthrough.length > 0 ? passthrough : ["rss-admin-ui"])
      ]);
    }
    break;
  case "diagnose":
    diagnose();
    break;
  default:
    fail("usage: production-compose-ops.mjs <ps|logs|config|up|recreate|diagnose> [--dry-run] [docker compose args]");
}

function diagnose() {
  if (runtimeOverlayBlocked) {
    printBlocked("diagnose");
    process.exitCode = 1;
    return;
  }

  const args = composeBaseArgs(true);
  const config = runCompose([...args, "config", "--quiet"], { allowFailure: true, capture: true });
  const ps = runCompose([...args, "ps"], { allowFailure: true, capture: true });
  const output = {
    status: config.status === 0 ? "frontend-production-compose-diagnostics-ok" : "frontend-production-compose-diagnostics-failed",
    compose_file: composeFile,
    compose_files: composeFiles(true),
    env_file: envFilePresent ? envFile : "not-present",
    backend_network_overlay: args.includes(backendNetworkFile),
    upstream_topology: upstreamTopologySummary(),
    admin_api_proxy_template: {
      required_routes: ["/admin-api/operations/summary", "/admin-api/operations/drilldown"],
      effective_config: "/tmp/nginx/conf.d/default.conf",
      verify_after_image_rebuild: "docker compose exec rss-admin-ui sh -lc 'nginx -T 2>&1 | grep -F \"/admin-api/operations/summary\" && grep -F \"/admin-api/operations/drilldown\" /tmp/nginx/conf.d/default.conf && ! grep -F \"__ADMIN_UI_\" /tmp/nginx/conf.d/default.conf'"
    },
    config_status: config.status,
    ps_status: ps.status,
    next_steps: [
      "if nginx.conf or docker-entrypoint.sh changed, rebuild/update the frontend image before recreate",
      "npm run ops:compose:config",
      "npm run ops:compose:recreate",
      "verify the running generated Nginx config contains /admin-api/operations/summary, /admin-api/operations/drilldown, and no unresolved __ADMIN_UI_*__ markers",
      "after backend API/image/network/admin-auth env recreate, run npm run ops:compose:recreate so frontend Nginx refreshes backend upstream/network references",
      "npm run ops:compose:ps",
      "npm run ops:compose:logs -- rss-admin-ui",
      "curl -fsS http://127.0.0.1:8081/healthz",
      "npm run auth-smoke:redacted -- --endpoint https://rss-panel.habersoft.com"
    ],
    output: "redacted"
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = config.status === 0 ? 0 : 1;
}

function requireRuntimePreflight(label) {
  if (!runtimeOverlayBlocked) return;
  printBlocked(label);
  process.exit(1);
}

function printBlocked(label) {
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "frontend-production-compose-command-blocked",
        command: label,
        reason: "backend_network_required_for_service_dns",
        compose_files: composeFiles(true),
        env_file: envFilePresent ? envFile : "not-present",
        backend_network_overlay: "required",
        required_env: "ADMIN_UI_BACKEND_DOCKER_NETWORK",
        service_dns_upstreams: serviceDnsUpstreams,
        next_steps: [
          "set ADMIN_UI_BACKEND_DOCKER_NETWORK to the existing backend Docker network name",
          "keep ADMIN_UI_HEALTH_UPSTREAM_ORIGIN and ADMIN_UI_AUTH_UPSTREAM_ORIGIN on the operator-approved backend service-DNS origin",
          "run npm run ops:compose:config",
          "run npm run ops:compose:recreate"
        ],
        output: "redacted"
      },
      null,
      2
    )}\n`
  );
}

function printCommandSummary(label, args) {
  const output = {
    status: "frontend-production-compose-command-ready",
    command: label,
    dry_run: dryRun,
    compose_files: composeFiles(args.includes(backendNetworkFile)),
    env_file: envFilePresent ? envFile : "not-present",
    backend_network_overlay: args.includes(backendNetworkFile),
    upstream_topology: upstreamTopologySummary(),
    output: "redacted"
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

function composeBaseArgs(forRuntime) {
  const includeOverlay = forRuntime ? runtimeOverlayRequired : backendNetworkConfigured;
  return [
    ...(envFilePresent ? ["--env-file", envFile] : []),
    "-f",
    composeFile,
    ...(includeOverlay ? ["-f", backendNetworkFile] : [])
  ];
}

function composeFiles(includeOverlay) {
  return [composeFile, ...(includeOverlay ? [backendNetworkFile] : [])];
}

function upstreamTopologySummary() {
  const names = ["ADMIN_UI_HEALTH_UPSTREAM_ORIGIN", "ADMIN_UI_AUTH_UPSTREAM_ORIGIN"];
  const topologies = new Set();
  for (const name of names) {
    const value = effectiveEnv[name] ?? "";
    if (value.trim() === "") continue;
    topologies.add(classifyOriginTopology(value));
  }
  if (topologies.size === 0) return "not_configured_or_degraded";
  if (topologies.size === 1) return [...topologies][0];
  return "mixed";
}

function serviceDnsUpstreamNames(env) {
  return ["ADMIN_UI_HEALTH_UPSTREAM_ORIGIN", "ADMIN_UI_AUTH_UPSTREAM_ORIGIN"].filter((name) => isServiceDnsOrigin(env[name] ?? ""));
}

function classifyOriginTopology(value) {
  const parsed = parseOrigin(value);
  if (parsed === undefined) return "invalid_or_degraded";
  const hostname = normalizeHostname(parsed.hostname);
  if (isPublicEdgeHost(hostname)) return "public_edge_rejected";
  if (isLoopbackOrUnspecifiedHost(hostname)) return "loopback_rejected";
  if (hostname === "host.docker.internal") return "host_gateway";
  if (isServiceDnsOrigin(value)) return "service_dns";
  return "internal_or_operator_proven";
}

function isServiceDnsOrigin(value) {
  const parsed = parseOrigin(value);
  if (parsed === undefined) return false;
  const hostname = normalizeHostname(parsed.hostname);
  if (hostname === "" || hostname === "host.docker.internal") return false;
  if (isPublicEdgeHost(hostname) || isLoopbackOrUnspecifiedHost(hostname)) return false;
  if (net.isIP(hostname) !== 0) return false;
  return !hostname.includes(".");
}

function parseOrigin(value) {
  if (value.trim() === "") return undefined;
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) return undefined;
    if (parsed.username !== "" || parsed.password !== "" || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function normalizeHostname(hostname) {
  let normalized = hostname.trim().toLowerCase().replace(/\.$/u, "");
  if (normalized.startsWith("[") && normalized.endsWith("]")) normalized = normalized.slice(1, -1);
  return normalized;
}

function isPublicEdgeHost(hostname) {
  return hostname === "rss.habersoft.com" || hostname === "rss-panel.habersoft.com";
}

function isLoopbackOrUnspecifiedHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "::" ||
    hostname === "::1" ||
    hostname === "0:0:0:0:0:0:0:0" ||
    hostname === "0:0:0:0:0:0:0:1" ||
    hostname === "0.0.0.0" ||
    hostname === "0" ||
    hostname.startsWith("127.")
  );
}

function isUsableBackendNetwork(value) {
  return typeof value === "string" && value.trim() !== "" && !/[<>\s]/u.test(value) && !/placeholder|change_me|backend_docker_network_name/iu.test(value);
}

function relevantEnv(fileValues) {
  const names = [
    "RSS_ADMIN_UI_IMAGE",
    "ADMIN_UI_HOST_PORT",
    "ADMIN_UI_BACKEND_DOCKER_NETWORK",
    "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN",
    "ADMIN_UI_AUTH_UPSTREAM_ORIGIN",
    "ADMIN_UI_ENVIRONMENT_NAME"
  ];
  return Object.fromEntries(names.map((name) => [name, process.env[name] ?? fileValues[name] ?? ""]));
}

function parseEnvFile(file) {
  if (/^ms-023a-secrets\.json$/iu.test(path.basename(file))) {
    fail("refusing to read ms-023a-secrets.json");
  }

  const parsed = {};
  const text = readFileSync(file, "utf8");
  for (const [lineIndex, rawLine] of text.split(/\r?\n/u).entries()) {
    let line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trimStart();
    const match = /^(?<name>[A-Z0-9_]+)=(?<value>.*)$/u.exec(line);
    if (match?.groups === undefined) {
      fail(`invalid env-file assignment on line ${lineIndex + 1}`);
    }
    let value = match.groups.value.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[match.groups.name] = value;
  }
  return parsed;
}

function runCompose(args, options = {}) {
  const result = spawnSync("docker", ["compose", ...args], {
    cwd: frontendRoot,
    env: process.env,
    encoding: "utf8",
    shell: false,
    timeout: 120000
  });

  if (options.capture !== true) {
    if ((result.stdout ?? "") !== "") process.stdout.write(result.stdout);
    if ((result.stderr ?? "") !== "") process.stderr.write(result.stderr);
  }

  if (!options.allowFailure && result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
