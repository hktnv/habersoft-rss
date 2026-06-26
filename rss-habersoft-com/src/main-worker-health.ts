import { reportBootstrapFailure } from "./bootstrap/bootstrap-error";
import { checkWorkerHealth } from "./worker/worker-health-entrypoint";

void checkWorkerHealth()
  .then((health) => {
    console.info(JSON.stringify(health));
    process.exit(0);
  })
  .catch((error: unknown) => {
    reportBootstrapFailure("main-service-worker-health", error);
  });
