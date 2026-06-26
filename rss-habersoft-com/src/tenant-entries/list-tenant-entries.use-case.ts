import { Injectable } from "@nestjs/common";
import { TenantEntryListRepository } from "./tenant-entry-list.repository";
import type { TenantEntryListInput, TenantEntryListItem } from "./tenant-entries.types";

@Injectable()
export class ListTenantEntriesUseCase {
  public constructor(private readonly repository: TenantEntryListRepository) {}

  public async execute(input: TenantEntryListInput): Promise<readonly TenantEntryListItem[]> {
    return this.repository.list(input);
  }
}
