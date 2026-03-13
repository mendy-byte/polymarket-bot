import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };

  return { ctx };
}

describe("autopilot", () => {
  it("returns autopilot status", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const status = await caller.autopilot.status();

    expect(status).toHaveProperty("isRunning");
    expect(status).toHaveProperty("intervalHours");
    expect(status).toHaveProperty("maxOrdersPerCycle");
    expect(status).toHaveProperty("scanPages");
    expect(status).toHaveProperty("autopilotEnabled");
    expect(typeof status.isRunning).toBe("boolean");
    expect(typeof status.intervalHours).toBe("number");
  });

  it("validates autopilot config update", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.autopilot.updateConfig({
      intervalHours: 6,
      maxOrdersPerCycle: 100,
      scanPages: 50,
    });

    expect(result).toEqual({ success: true });
  });

  it("rejects invalid interval hours", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.autopilot.updateConfig({ intervalHours: 0 })
    ).rejects.toThrow();

    await expect(
      caller.autopilot.updateConfig({ intervalHours: 25 })
    ).rejects.toThrow();
  });

  it("rejects invalid max orders", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.autopilot.updateConfig({ maxOrdersPerCycle: 0 })
    ).rejects.toThrow();

    await expect(
      caller.autopilot.updateConfig({ maxOrdersPerCycle: 201 })
    ).rejects.toThrow();
  });
});

describe("planktonXD flat bet sizing", () => {
  // The new strategy uses flat $5 bets — no smart sizing
  // flatBetSize = Math.min(5, maxPerEvent)
  function calculateFlatBetSize(maxPerEvent: number): number {
    return Math.min(5, maxPerEvent);
  }

  it("returns $5 flat bet by default", () => {
    expect(calculateFlatBetSize(5)).toBe(5);
    expect(calculateFlatBetSize(10)).toBe(5);
    expect(calculateFlatBetSize(25)).toBe(5);
  });

  it("caps at maxPerEvent if lower than $5", () => {
    expect(calculateFlatBetSize(3)).toBe(3);
    expect(calculateFlatBetSize(1)).toBe(1);
  });
});

describe("event group deduplication", () => {
  const MAX_POSITIONS_PER_EVENT_GROUP = 2;

  function filterByEventGroup(
    candidates: Array<{ eventSlug?: string | null; marketId: string }>,
    existingGroupCounts: Map<string, number>,
  ): Set<string> {
    const batchGroupCounts = new Map<string, number>();
    const allowedMarketIds = new Set<string>();

    for (const event of candidates) {
      const slug = event.eventSlug || event.marketId;
      const existingCount = existingGroupCounts.get(slug) || 0;
      const batchCount = batchGroupCounts.get(slug) || 0;
      const totalCount = existingCount + batchCount;

      if (totalCount < MAX_POSITIONS_PER_EVENT_GROUP) {
        batchGroupCounts.set(slug, batchCount + 1);
        allowedMarketIds.add(event.marketId);
      }
    }

    return allowedMarketIds;
  }

  it("allows candidates from new event groups", () => {
    const candidates = [
      { eventSlug: "nba-finals-2026", marketId: "m1" },
      { eventSlug: "world-cup-2026", marketId: "m2" },
    ];
    const existing = new Map<string, number>();
    const allowed = filterByEventGroup(candidates, existing);
    expect(allowed.size).toBe(2);
    expect(allowed.has("m1")).toBe(true);
    expect(allowed.has("m2")).toBe(true);
  });

  it("blocks candidates from event groups already at max", () => {
    const candidates = [
      { eventSlug: "presidential-2028", marketId: "m1" },
      { eventSlug: "presidential-2028", marketId: "m2" },
    ];
    // Already have 2 positions in this group
    const existing = new Map([["presidential-2028", 2]]);
    const allowed = filterByEventGroup(candidates, existing);
    expect(allowed.size).toBe(0);
  });

  it("allows 1 more when group has 1 existing position", () => {
    const candidates = [
      { eventSlug: "presidential-2028", marketId: "m1" },
      { eventSlug: "presidential-2028", marketId: "m2" },
      { eventSlug: "presidential-2028", marketId: "m3" },
    ];
    const existing = new Map([["presidential-2028", 1]]);
    const allowed = filterByEventGroup(candidates, existing);
    // Should allow exactly 1 more (to reach max of 2)
    expect(allowed.size).toBe(1);
    expect(allowed.has("m1")).toBe(true);
  });

  it("limits within-batch to max per group", () => {
    const candidates = [
      { eventSlug: "nba-finals", marketId: "m1" },
      { eventSlug: "nba-finals", marketId: "m2" },
      { eventSlug: "nba-finals", marketId: "m3" },
      { eventSlug: "world-cup", marketId: "m4" },
    ];
    const existing = new Map<string, number>();
    const allowed = filterByEventGroup(candidates, existing);
    // nba-finals: 2 allowed (max), world-cup: 1 allowed
    expect(allowed.size).toBe(3);
    expect(allowed.has("m1")).toBe(true);
    expect(allowed.has("m2")).toBe(true);
    expect(allowed.has("m3")).toBe(false);
    expect(allowed.has("m4")).toBe(true);
  });

  it("uses marketId as fallback when eventSlug is null", () => {
    const candidates = [
      { eventSlug: null, marketId: "unique-market-1" },
      { eventSlug: null, marketId: "unique-market-2" },
    ];
    const existing = new Map<string, number>();
    const allowed = filterByEventGroup(candidates, existing);
    expect(allowed.size).toBe(2);
  });

  it("correctly mixes existing and batch counts", () => {
    const candidates = [
      { eventSlug: "group-a", marketId: "m1" },
      { eventSlug: "group-b", marketId: "m2" },
      { eventSlug: "group-b", marketId: "m3" },
      { eventSlug: "group-c", marketId: "m4" },
    ];
    const existing = new Map([
      ["group-a", 1],  // 1 existing, can add 1 more
      ["group-b", 2],  // already at max, block all
      // group-c: 0 existing, can add 2
    ]);
    const allowed = filterByEventGroup(candidates, existing);
    expect(allowed.size).toBe(2); // m1 (group-a) + m4 (group-c)
    expect(allowed.has("m1")).toBe(true);
    expect(allowed.has("m2")).toBe(false);
    expect(allowed.has("m3")).toBe(false);
    expect(allowed.has("m4")).toBe(true);
  });
});

describe("category diversification with 15% cap", () => {
  function canBuyInCategory(
    category: string,
    betSize: number,
    categoryUsage: Map<string, { count: number; totalCost: number }>,
    totalDeployed: number,
    maxCategoryPercent: number,
  ): boolean {
    const usage = categoryUsage.get(category) || { count: 0, totalCost: 0 };
    const newTotal = totalDeployed + betSize;
    const newCatCost = usage.totalCost + betSize;
    const newPercent = newTotal > 0 ? (newCatCost / newTotal) * 100 : 0;
    return newPercent <= maxCategoryPercent;
  }

  it("allows buying when category is under 15% limit", () => {
    const usage = new Map([["politics", { count: 2, totalCost: 10 }]]);
    // 10+5 = 15 out of 500+5 = 505 → 2.97% < 15%
    expect(canBuyInCategory("politics", 5, usage, 500, 15)).toBe(true);
  });

  it("blocks buying when category would exceed 15% limit", () => {
    const usage = new Map([["politics", { count: 15, totalCost: 75 }]]);
    // 75+5 = 80 out of 500+5 = 505 → 15.8% > 15%
    expect(canBuyInCategory("politics", 5, usage, 500, 15)).toBe(false);
  });

  it("allows buying at exactly 15%", () => {
    const usage = new Map([["politics", { count: 14, totalCost: 70 }]]);
    // 70+5 = 75 out of 500+5 = 505 → 14.85% < 15%
    expect(canBuyInCategory("politics", 5, usage, 500, 15)).toBe(true);
  });

  it("allows new category with no existing usage", () => {
    const usage = new Map<string, { count: number; totalCost: number }>();
    // 5/(100+5) = 4.76% < 15%
    expect(canBuyInCategory("sports", 5, usage, 100, 15)).toBe(true);
  });

  it("blocks first buy when no existing portfolio (100% > 15%)", () => {
    const usage = new Map<string, { count: number; totalCost: number }>();
    // 5/(0+5) = 100% > 15%
    expect(canBuyInCategory("crypto", 5, usage, 0, 15)).toBe(false);
  });

  it("allows first buy when there is existing portfolio", () => {
    const usage = new Map<string, { count: number; totalCost: number }>();
    // 5/(100+5) = 4.76% < 15%
    expect(canBuyInCategory("crypto", 5, usage, 100, 15)).toBe(true);
  });
});

describe("AI reject-only filter scoring", () => {
  // The new AI evaluator uses scores 1-10:
  // 1-2 = impossible/absurd → reject
  // 3+ = plausible enough → buy
  function shouldBuy(score: number): boolean {
    return score >= 3;
  }

  it("rejects score 1 (impossible)", () => {
    expect(shouldBuy(1)).toBe(false);
  });

  it("rejects score 2 (absurd)", () => {
    expect(shouldBuy(2)).toBe(false);
  });

  it("approves score 3 (unlikely but possible)", () => {
    expect(shouldBuy(3)).toBe(true);
  });

  it("approves score 5 (moderate chance)", () => {
    expect(shouldBuy(5)).toBe(true);
  });

  it("approves score 7 (good chance)", () => {
    expect(shouldBuy(7)).toBe(true);
  });

  it("approves score 10 (very likely)", () => {
    expect(shouldBuy(10)).toBe(true);
  });
});

describe("portfolio placeOrder", () => {
  it("rejects amounts over $25", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.portfolio.placeOrder({ scannedEventId: 1, amountUsd: 30 })
    ).rejects.toThrow();
  });

  it("rejects negative amounts", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.portfolio.placeOrder({ scannedEventId: 1, amountUsd: -5 })
    ).rejects.toThrow();
  });
});
