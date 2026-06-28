import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "rss-habersoft-com");
const failures = [];

const requiredFiles = [
  "README.md",
  "PRODUCTION.md",
  ".docs/production-activation-package.md",
  ".docs/admin-auth-production-operator-handoff.md",
  "scripts/production-mode-rc.mjs",
  "scripts/production-activation-package-verify.mjs",
  "../rss-habersoft-com/scripts/admin-auth-provisioning.mjs",
  "../rss-habersoft-com/.docs/admin-auth-production-activation.md"
];

for (const file of requiredFiles) requireFile(file);
assertPackageScripts();
assertDocsBoundary();
assertBackendProvisioningScripts();
assertBrowserSurface();
assertProductionComposeTemplates();

if (failures.length > 0) {
  for (const failure of failures) console.error(`production-activation-package-verify: ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "production-activation-package-verify-ok",
      admin_ui_state: "MS-022B_PRODUCTION_ACTIVATION_PACKAGE_READY - NOT_DEPLOYED",
      provisioning_helpers: "present",
      local_rc_harness: "present",
      production_contact: false,
      registry_publication: false
    },
    null,
    2
  )
);

function assertPackageScripts() {
  const frontendPackage = JSON.parse(readFrontend("package.json"));
  const backendPackage = JSON.parse(readBackend("package.json"));
  const frontendScripts = frontendPackage.scripts ?? {};
  const backendScripts = backendPackage.scripts ?? {};
  const requiredFrontend = {
    "verify:production-activation-package": "node scripts/production-activation-package-verify.mjs",
    "test:production-mode-rc": "node scripts/production-mode-rc.mjs"
  };
  const requiredBackend = {
    "admin-auth:hash": "node scripts/admin-auth-provisioning.mjs hash",
    "admin-auth:secret": "node scripts/admin-auth-provisioning.mjs secret",
    "admin-auth:verify-config": "node scripts/admin-auth-provisioning.mjs verify-config"
  };

  for (const [name, command] of Object.entries(requiredFrontend)) {
    if (frontendScripts[name] !== command) failures.push(`frontend package.json missing ${name}`);
  }
  for (const [name, command] of Object.entries(requiredBackend)) {
    if (backendScripts[name] !== command) failures.push(`backend package.json missing ${name}`);
  }
}

function assertDocsBoundary() {
  const docs = [
    readRoot("README.md"),
    readRoot("PRODUCTION.md"),
    readFrontend("README.md"),
    readFrontend("PRODUCTION.md"),
    readFrontend(".docs/production-activation-package.md"),
    readFrontend(".docs/admin-auth-production-operator-handoff.md"),
    readBackend("README.md"),
    readBackend("PRODUCTION.md"),
    readBackend(".docs/admin-auth-production-activation.md")
  ].join("\n");

  const required = [
    "MS-022B_PRODUCTION_ACTIVATION_PACKAGE_READY",
    "NOT_DEPLOYED",
    "ADMIN_UI_AUTH_MODE",
    "ADMIN_UI_ADMIN_USERNAME",
    "ADMIN_UI_ADMIN_PASSWORD_HASH",
    "ADMIN_UI_SESSION_SECRET",
    "ADMIN_UI_SESSION_COOKIE_SECURE",
    "ADMIN_UI_AUTH_UPSTREAM_ORIGIN",
    "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN",
    "/admin-auth/session",
    "/admin-auth/login",
    "/admin-auth/logout",
    "/status-api/health/live",
    "/status-api/health/ready",
    "same-origin",
    "no production deployment",
    "no registry",
    "no Git tag",
    "operator-authorized"
  ];
  for (const fragment of required) {
    if (!docs.includes(fragment)) failures.push(`docs missing ${fragment}`);
  }

  const forbiddenClaims = [
    /\brss-admin-ui\b[^\n]{0,80}\b(?:is|has been)\s+deployed\b/iu,
    /\badmin UI\s+(?:is|has been)\s+production active\b/iu,
    /\bproduction admin auth\s+(?:is|has been)\s+enabled\b/iu
  ];
  for (const pattern of forbiddenClaims) {
    if (pattern.test(docs)) {
      failures.push(`docs contain a forbidden production-active claim: ${pattern}`);
    }
  }
}

function assertBackendProvisioningScripts() {
  const synthetic = run("npm", ["run", "admin-auth:verify-config", "--", "--synthetic", "--require-enabled"], {
    cwd: backendRoot
  });
  if (synthetic.status !== 0) failures.push("backend synthetic admin auth config verifier failed");
  if (/synthetic-ms022b-admin-password|synthetic_ms022b_admin_session_secret/iu.test(synthetic.stdout + synthetic.stderr)) {
    failures.push("backend config verifier printed synthetic secret material");
  }
}

function assertBrowserSurface() {
  const files = [
    ...collectFiles(path.join(frontendRoot, "src")),
    ...collectFiles(path.join(frontendRoot, "public")),
    path.join(frontendRoot, "index.html"),
    ...collectFiles(path.join(frontendRoot, "dist"))
  ].filter((file) => existsSync(file) && statSync(file).isFile());

  const forbidden = [
    { label: "agent key header", pattern: /X-Agent-Key/iu },
    { label: "agent key env", pattern: /AGENT_KEY\s*=/u },
    { label: "tenant bearer", pattern: /bearer\s+[a-z0-9._~+/-]{12,}/iu },
    { label: "browser auth persistence", pattern: /\b(localStorage|sessionStorage|indexedDB|cookieStore)\b|document\.cookie/u },
    { label: "server upstream origin env", pattern: /ADMIN_UI_(?:HEALTH|AUTH)_UPSTREAM_ORIGIN/u },
    { label: "local compose upstream", pattern: /main-service-api:3000/u },
    { label: "synthetic password", pattern: /synthetic-ms022b-admin-password/u },
    { label: "synthetic session secret", pattern: /synthetic_ms022b_admin_session_secret/u },
    { label: "private key", pattern: /BEGIN (?:RSA )?PRIVATE KEY/u }
  ];

  for (const file of files) {
    if (!/\.(ts|tsx|js|mjs|html|css|json)$/iu.test(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const check of forbidden) {
      if (check.pattern.test(text)) {
        failures.push(`${check.label} in browser source/build: ${path.relative(frontendRoot, file)}`);
        break;
      }
    }
  }
}

function assertProductionComposeTemplates() {
  const env = {
    RSS_ADMIN_UI_IMAGE: "rss-admin-ui@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ADMIN_UI_HEALTH_UPSTREAM_ORIGIN: "http://127.0.0.1:3200",
    ADMIN_UI_AUTH_UPSTREAM_ORIGIN: "http://127.0.0.1:3200",
    ADMIN_UI_ENVIRONMENT_NAME: "production-activation-package-local",
    ADMIN_UI_HOST_PORT: "8081"
  };
  const result = run("docker", ["compose", "-f", path.join("deploy", "production", "compose.yaml"), "config", "--quiet"], {
    cwd: frontendRoot,
    env
  });
  if (result.status !== 0) failures.push("frontend production compose template did not render with synthetic env");
}

function run(command, args, options = {}) {
  const invocation = resolveCommand(command, args);
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd: options.cwd ?? frontendRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: "utf8",
    shell: false,
    timeout: options.timeoutMs ?? 120000
  });
  return result;
}

function resolveCommand(command, args) {
  if (command === "npm" && process.env.npm_execpath !== undefined) {
    return { executable: process.execPath, args: [process.env.npm_execpath, ...args] };
  }
  return { executable: command, args };
}

function requireFile(relative) {
  const absolute = path.resolve(frontendRoot, relative);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) failures.push(`missing required file: ${relative}`);
}

function readRoot(relative) {
  return readFileSync(path.join(repoRoot, relative), "utf8");
}

function readFrontend(relative) {
  return readFileSync(path.join(frontendRoot, relative), "utf8");
}

function readBackend(relative) {
  return readFileSync(path.join(backendRoot, relative), "utf8");
}

function collectFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(absolute);
    return entry.isFile() ? [absolute] : [];
  });
}
