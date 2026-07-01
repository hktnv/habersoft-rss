export const ADMIN_FEED_ONBOARDING_SITE_CLIENT_ID = "__habersoft_admin_feed_onboarding__";

export function isReservedSiteClientId(value: string): boolean {
  return value === ADMIN_FEED_ONBOARDING_SITE_CLIENT_ID || value.startsWith("__habersoft_admin_");
}
