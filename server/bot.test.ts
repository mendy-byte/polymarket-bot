import { describe, expect, it, vi, beforeEach } from "vitest";
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

describe("auth.me", () => {
  it("returns null for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });

  it("returns user for authenticated users", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeDefined();
    expect(result?.openId).toBe("test-user");
    expect(result?.name).toBe("Test User");
  });
});

describe("dashboard.stats", () => {
  it("requires authentication", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.dashboard.stats()).rejects.toThrow();
  });

  it("returns stats for authenticated users", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.dashboard.stats();
    expect(result).toBeDefined();
    expect(typeof result?.totalCapitalDeployed).toBe("number");
    expect(typeof result?.totalPositions).toBe("number");
    expect(typeof result?.openPositions).toBe("number");
    expect(typeof result?.killSwitch).toBe("boolean");
    expect(typeof result?.botEnabled).toBe("boolean");
  });
});

describe("dashboard.recentLogs", () => {
  it("requires authentication", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.dashboard.recentLogs()).rejects.toThrow();
  });

  it("returns logs array for authenticated users", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.dashboard.recentLogs();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("scanner.events", () => {
  it("requires authentication", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.scanner.events()).rejects.toThrow();
  });

  it("returns events array for authenticated users", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.scanner.events();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("risk.config", () => {
  it("requires authentication", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.risk.config()).rejects.toThrow();
  });

  it("returns risk configuration with defaults", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.risk.config();
    expect(result).toBeDefined();
    expect(result.maxTotalCapital).toBe(2000);
    expect(result.maxPerEvent).toBe(5);
    expect(result.maxCategoryPercent).toBe(30);
    expect(result.dailyBuyBudget).toBe(200);
    expect(result.minPrice).toBe(0.001);
    expect(result.maxPrice).toBe(0.03);
    expect(typeof result.killSwitch).toBe("boolean");
    expect(typeof result.botEnabled).toBe("boolean");
  });
});

describe("risk.killSwitch", () => {
  it("requires authentication", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.risk.killSwitch({ enabled: true })).rejects.toThrow();
  });

  it("activates kill switch", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.risk.killSwitch({ enabled: true });
    expect(result.success).toBe(true);
    expect(result.killSwitch).toBe(true);
  });

  it("deactivates kill switch", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.risk.killSwitch({ enabled: false });
    expect(result.success).toBe(true);
    expect(result.killSwitch).toBe(false);
  });
});

describe("risk.toggleBot", () => {
  it("enables bot", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.risk.toggleBot({ enabled: true });
    expect(result.success).toBe(true);
    expect(result.botEnabled).toBe(true);
  });

  it("disables bot", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.risk.toggleBot({ enabled: false });
    expect(result.success).toBe(true);
    expect(result.botEnabled).toBe(false);
  });
});

describe("risk.updateConfig", () => {
  it("updates a config value", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.risk.updateConfig({ key: "maxPerEvent", value: "10" });
    expect(result.success).toBe(true);
  });
});

describe("portfolio.positions", () => {
  it("requires authentication", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.portfolio.positions()).rejects.toThrow();
  });

  it("returns positions array", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.portfolio.positions();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("portfolio.orders", () => {
  it("returns orders array", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.portfolio.orders();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("wallet.status", () => {
  it("requires authentication", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.wallet.status()).rejects.toThrow();
  });

  it("returns wallet status", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.wallet.status();
    expect(result).toBeDefined();
    expect(typeof result.configured).toBe("boolean");
    expect(typeof result.address).toBe("string");
  });
});

describe("risk.categoryBreakdown", () => {
  it("returns category breakdown array", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.risk.categoryBreakdown();
    expect(Array.isArray(result)).toBe(true);
  });
});
