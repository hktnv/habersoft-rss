import { Injectable } from "@nestjs/common";
import type { TenantEntryDetailInput, TenantEntryDetailItem } from "./tenant-entry-detail.types";
import { TenantEntryDetailRepository } from "./tenant-entry-detail.repository";

@Injectable()
export class GetTenantEntryDetailUseCase {
  public constructor(private readonly repository: TenantEntryDetailRepository) {}

  public async execute(input: TenantEntryDetailInput): Promise<TenantEntryDetailItem | null> {
    return this.repository.get(input);
  }
}
