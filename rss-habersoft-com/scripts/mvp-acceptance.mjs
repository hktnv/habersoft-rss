import { spawnSync } from "node:child_process";

const requiredEnvironment = ["DATABASE_URL", "REDIS_URL"];
const missing = requiredEnvironment.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.error(`test:mvp-acceptance requires container/runtime environment: missing ${missing.join(", ")}`);
  process.exit(1);
}

const steps = [
  ["npm", ["test"]],
  ["npm", ["run", "test:db"]],
  ["npm", ["run", "build"]],
  ["npm", ["run", "prisma:validate"]],
  ["npm", ["run", "prisma:generate"]],
  ["npm", ["run", "migrate:status"]]
];

for (const [command, args] of steps) {
  run(command, args);
}

console.log("test:mvp-acceptance complete");

function run(command, args) {
  console.log(`\n> ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
