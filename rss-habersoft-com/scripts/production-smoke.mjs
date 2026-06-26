const args = parseArgs(process.argv.slice(2));
const baseUrl = args["base-url"];

if (baseUrl === undefined) {
  console.log("production-smoke: no --base-url supplied; deployment smoke skipped");
  process.exit(0);
}

const root = baseUrl.replace(/\/$/u, "");
const live = await fetch(`${root}/health/live`);
const ready = await fetch(`${root}/health/ready`);
const unknown = await fetch(`${root}/unknown-ms016-smoke`);

if (live.status !== 200 || ready.status !== 200 || unknown.status !== 404) {
  console.error(`production-smoke failed: live=${live.status} ready=${ready.status} unknown=${unknown.status}`);
  process.exit(1);
}

console.log(`production-smoke: ok ${root}`);

function parseArgs(rawArgs) {
  const result = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    result[arg.slice(2)] = rawArgs[index + 1];
    index += 1;
  }
  return result;
}
