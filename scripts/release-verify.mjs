import { spawnSync } from "node:child_process";

const steps = [
  ["node", ["scripts/release-static-integrity.mjs"]],
  ["git", ["diff", "--check"]],
  ["npm", ["run", "prisma:generate"]],
  ["npm", ["run", "lint"]],
  ["npm", ["run", "typecheck"]],
  ["npm", ["test"]],
  ["npm", ["run", "prisma:validate"]],
  ["npm", ["audit", "--omit=dev"]],
  ["npm", ["run", "build"]]
];

for (const [command, args] of steps) {
  run(command, args);
}

console.log("release:verify complete. Run npm run test:mvp-acceptance in a container with PostgreSQL and Redis.");

function run(command, args) {
  console.log(`\n> ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
