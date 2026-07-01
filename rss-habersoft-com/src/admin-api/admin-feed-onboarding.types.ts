export type AdminFeedOnboardingStatus = "created" | "already_exists" | "unavailable" | "rate_limited";

export type AdminFeedOnboardingResponse = {
  readonly status: AdminFeedOnboardingStatus;
  readonly requestRef: string | null;
  readonly feed: {
    readonly displayId: string;
    readonly sourceHost: string;
    readonly state: "pending" | "active" | "disabled";
    readonly eligibleForRecheck: boolean;
  } | null;
  readonly nextSteps: readonly string[];
  readonly message: string;
  readonly generatedAt: string;
};
