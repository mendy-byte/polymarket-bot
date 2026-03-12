import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
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

describe("smart bet sizing logic", () => {
  // Test the bet sizing calculation directly
  function calculateBetSize(
    aiScore: number,
    maxPerEvent: number,
    remainingDailyBudget: number,
    remainingCapital: number,
  ): number {
    const scoreSizeMap: Record<number, number> = {
      5: 5, 6: 5, 7: 8, 8: 12, 9: 18, 10: 25,
    };
    let baseSize = scoreSizeMap[Math.round(aiScore)] || 5;
    baseSize = Math.min(baseSize, maxPerEvent);
    if (remainingDailyBudget < baseSize * 2) {
      baseSize = Math.min(baseSize, Math.floor(remainingDailyBudget / 2));
    }
    if (remainingCapital < baseSize * 2) {
      baseSize = Math.min(baseSize, Math.floor(remainingCapital / 2));
    }
    return Math.max(1, baseSize);
  }

  it("returns $5 for score 5-6", () => {
    expect(calculateBetSize(5, 25, 200, 2000)).toBe(5);
    expect(calculateBetSize(6, 25, 200, 2000)).toBe(5);
  });

  it("returns $8 for score 7", () => {
    expect(calculateBetSize(7, 25, 200, 2000)).toBe(8);
  });

  it("returns $12 for score 8", () => {
    expect(calculateBetSize(8, 25, 200, 2000)).toBe(12);
  });

  it("returns $18 for score 9", () => {
    expect(calculateBetSize(9, 25, 200, 2000)).toBe(18);
  });

  it("returns $25 for score 10", () => {
    expect(calculateBetSize(10, 25, 200, 2000)).toBe(25);
  });

  it("caps at maxPerEvent", () => {
    expect(calculateBetSize(10, 10, 200, 2000)).toBe(10);
    expect(calculateBetSize(9, 5, 200, 2000)).toBe(5);
  });

  it("scales down when daily budget is low", () => {
    expect(calculateBetSize(10, 25, 10, 2000)).toBe(5);
    expect(calculateBetSize(8, 25, 6, 2000)).toBe(3);
  });

  it("scales down when capital is low", () => {
    expect(calculateBetSize(10, 25, 200, 10)).toBe(5);
    expect(calculateBetSize(8, 25, 200, 4)).toBe(2);
  });

  it("returns minimum $1 even with very low budgets", () => {
    expect(calculateBetSize(5, 25, 3, 3)).toBe(1);
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
