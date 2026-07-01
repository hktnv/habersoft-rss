export type AdminFeedRecheckStatus = "accepted" | "already_pending" | "unavailable" | "not_found" | "rate_limited";

export type AdminFeedRecheckResponse = {
  readonly status: AdminFeedRecheckStatus;
  readonly requestId: string | null;
  readonly target: {
    readonly displayId: string;
    readonly sourceHost: string | null;
  } | null;
  readonly queued: boolean;
  readonly cooldownSeconds: number | null;
  readonly message: string;
  readonly generatedAt: string;
};

export type AdminFeedRecheckUnavailableReason =
  | "admin_auth_not_configured"
  | "inactive_feed"
  | "no_subscribers"
  | "source_host_redacted";

export type AdminFeedRecheckActionMetadata =
  | {
      readonly canRequestRecheck: true;
      readonly recheckUnavailableReason: null;
      readonly actionRef: string;
    }
  | {
      readonly canRequestRecheck: false;
      readonly recheckUnavailableReason: AdminFeedRecheckUnavailableReason;
      readonly actionRef: null;
    };
