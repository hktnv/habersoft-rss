import { reportBootstrapFailure } from "./bootstrap/bootstrap-error";
import { installWorkerShutdown, startWorker } from "./bootstrap/worker-entrypoint";

void startWorker()
  .then((app) => {
    installWorkerShutdown(app);
    console.info("main-service-worker started");
  })
  .catch((error: unknown) => {
    reportBootstrapFailure("main-service-worker", error);
  });
