import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createAuthContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-user",
      email: "test@example.com",
      name: "Test User",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("portfolio.resolvedSummary", () => {
  it("requires authentication", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.portfolio.resolvedSummary()).rejects.toThrow();
  });

  it("returns resolved summary data for authenticated users", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.portfolio.resolvedSummary();
    expect(result).toBeDefined();
    // Should have all expected fields
    expect(typeof result?.totalResolved).toBe("number");
    expect(typeof result?.totalWins).toBe("number");
    expect(typeof result?.totalLosses).toBe("number");
    expect(typeof result?.winRate).toBe("number");
    expect(typeof result?.totalCostResolved).toBe("number");
    expect(typeof result?.totalPayout).toBe("number");
    expect(typeof result?.totalPnl).toBe("number");
    expect(typeof result?.totalPnlPercent).toBe("number");
    expect(typeof result?.winPnl).toBe("number");
    expect(typeof result?.lossPnl).toBe("number");
    expect(typeof result?.avgWinPnl).toBe("number");
    expect(typeof result?.avgLossPnl).toBe("number");
    expect(typeof result?.openPositionsCount).toBe("number");
    expect(typeof result?.totalOpenCost).toBe("number");
  });

  it("returns category breakdown as array", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.portfolio.resolvedSummary();
    expect(result).toBeDefined();
    expect(Array.isArray(result?.categoryBreakdown)).toBe(true);
  });

  it("returns monthly breakdown as array", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.portfolio.resolvedSummary();
    expect(result).toBeDefined();
    expect(Array.isArray(result?.monthlyBreakdown)).toBe(true);
  });

  it("returns resolved positions as array", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.portfolio.resolvedSummary();
    expect(result).toBeDefined();
    expect(Array.isArray(result?.resolvedPositions)).toBe(true);
  });

  it("win rate is between 0 and 100", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.portfolio.resolvedSummary();
    expect(result).toBeDefined();
    expect(result!.winRate).toBeGreaterThanOrEqual(0);
    expect(result!.winRate).toBeLessThanOrEqual(100);
  });

  it("totalResolved equals totalWins + totalLosses", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.portfolio.resolvedSummary();
    expect(result).toBeDefined();
    expect(result!.totalResolved).toBe(result!.totalWins + result!.totalLosses);
  });

  it("resolved positions count matches totalResolved", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.portfolio.resolvedSummary();
    expect(result).toBeDefined();
    expect(result!.resolvedPositions.length).toBe(result!.totalResolved);
  });

  it("category breakdown entries have required fields", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.portfolio.resolvedSummary();
    expect(result).toBeDefined();
    for (const cat of result!.categoryBreakdown) {
      expect(typeof cat.category).toBe("string");
      expect(typeof cat.wins).toBe("number");
      expect(typeof cat.losses).toBe("number");
      expect(typeof cat.costBasis).toBe("number");
      expect(typeof cat.pnl).toBe("number");
      expect(typeof cat.payout).toBe("number");
      expect(typeof cat.winRate).toBe("number");
      expect(typeof cat.roi).toBe("number");
    }
  });

  it("monthly breakdown entries have required fields", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.portfolio.resolvedSummary();
    expect(result).toBeDefined();
    for (const m of result!.monthlyBreakdown) {
      expect(typeof m.month).toBe("string");
      expect(m.month).toMatch(/^\d{4}-\d{2}$/); // YYYY-MM format
      expect(typeof m.wins).toBe("number");
      expect(typeof m.losses).toBe("number");
      expect(typeof m.pnl).toBe("number");
      expect(typeof m.winRate).toBe("number");
      expect(typeof m.roi).toBe("number");
    }
  });
});
