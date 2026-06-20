export class TenantEntryDetailInvariantError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TenantEntryDetailInvariantError";
  }
}
