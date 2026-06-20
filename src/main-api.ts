import { reportBootstrapFailure } from "./bootstrap/bootstrap-error";
import { startApi } from "./bootstrap/api-entrypoint";

void startApi().catch((error: unknown) => {
  reportBootstrapFailure("main-service-api", error);
});
