import { ListTenantFeedsUseCase } from "../../src/tenant-feeds/list-tenant-feeds.use-case";
import { SubscribeFeedUseCase } from "../../src/tenant-feeds/subscribe-feed.use-case";
import type { TenantFeedSubscriptionsRepository } from "../../src/tenant-feeds/tenant-feed-subscriptions.repository";
import { UnsubscribeFeedUseCase } from "../../src/tenant-feeds/unsubscribe-feed.use-case";
import { createTenantPrincipal } from "../../src/tenant-auth/tenant-principal";

describe("tenant feed use cases", () => {
  const principal = createTenantPrincipal({
    subject: "site-a",
    scopes: ["services:access"]
  });

  it("subscribes using only the immutable tenant principal siteClientId", async () => {
    const repository = {
      subscribe: jest.fn().mockResolvedValue({
        outcome: "created_feed",
        feedId: 1n,
        url: "https://example.test/rss.xml"
      })
    } as unknown as TenantFeedSubscriptionsRepository;
    const useCase = new SubscribeFeedUseCase(repository);

    await expect(useCase.execute(principal, "https://example.test/rss.xml")).resolves.toMatchObject({
      outcome: "created_feed",
      feedId: 1n
    });
    expect(repository.subscribe).toHaveBeenCalledWith({
      siteClientId: "site-a",
      url: "https://example.test/rss.xml"
    });
  });

  it("lists using only the immutable tenant principal siteClientId", async () => {
    const repository = {
      list: jest.fn().mockResolvedValue([])
    } as unknown as TenantFeedSubscriptionsRepository;
    const useCase = new ListTenantFeedsUseCase(repository);

    await expect(useCase.execute(principal)).resolves.toEqual([]);
    expect(repository.list).toHaveBeenCalledWith("site-a");
  });

  it("unsubscribes using only the immutable tenant principal siteClientId", async () => {
    const repository = {
      unsubscribe: jest.fn().mockResolvedValue({ outcome: "unsubscribed" })
    } as unknown as TenantFeedSubscriptionsRepository;
    const useCase = new UnsubscribeFeedUseCase(repository);

    await expect(useCase.execute(principal, 10n)).resolves.toEqual({ outcome: "unsubscribed" });
    expect(repository.unsubscribe).toHaveBeenCalledWith({
      siteClientId: "site-a",
      feedId: 10n
    });
  });
});
