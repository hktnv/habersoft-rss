import { DynamicModule, Global, Module } from "@nestjs/common";
import { RuntimeConfig } from "./runtime-config";

export const RUNTIME_CONFIG = Symbol("RUNTIME_CONFIG");

@Global()
@Module({})
export class RuntimeConfigModule {
  public static register(config: RuntimeConfig): DynamicModule {
    return {
      module: RuntimeConfigModule,
      providers: [
        {
          provide: RUNTIME_CONFIG,
          useValue: config
        }
      ],
      exports: [RUNTIME_CONFIG]
    };
  }
}
