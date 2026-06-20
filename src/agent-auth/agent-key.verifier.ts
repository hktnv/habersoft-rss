import { createHash, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { RUNTIME_CONFIG } from "../configuration/runtime-config.module";
import { RuntimeConfig } from "../configuration/runtime-config";

@Injectable()
export class AgentKeyVerifier {
  private readonly expectedDigest: Buffer;

  public constructor(@Inject(RUNTIME_CONFIG) config: RuntimeConfig) {
    if (config.agentAuth === undefined) {
      throw new Error("Agent auth configuration is required for the API role");
    }

    this.expectedDigest = this.digest(config.agentAuth.key);
  }

  public verify(candidate: string): boolean {
    const candidateDigest = this.digest(candidate);
    return timingSafeEqual(candidateDigest, this.expectedDigest);
  }

  private digest(value: string): Buffer {
    return createHash("sha256").update(value, "utf8").digest();
  }
}
