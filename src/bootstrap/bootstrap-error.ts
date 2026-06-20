import { ConfigValidationError } from "../configuration/runtime-config";

export function reportBootstrapFailure(processName: string, error: unknown): never {
  if (error instanceof ConfigValidationError) {
    console.error(error.message);
  } else {
    console.error(`${processName} bootstrap failed`);
  }

  process.exit(1);
}
