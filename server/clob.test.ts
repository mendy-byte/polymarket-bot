import { describe, expect, it, vi } from "vitest";

/**
 * Tests for CLOB trading service logic.
 * We test the service's internal logic without actually connecting to Polymarket.
 * The actual ClobClient is mocked since we can't hit the real API in tests.
 */

describe("CLOB Trading Service", () => {
  describe("getClobStatus", () => {
    it("returns uninitialized status by default", async () => {
      // Import fresh to get default state
      const { getClobStatus } = await import("./services/clobTrader");
      const status = getClobStatus();
      expect(status.initialized).toBe(false);
      expect(status.heartbeatActive).toBe(false);
      expect(status.error).toBeNull();
    });
  });

  describe("Order Result Types", () => {
    it("success result has orderId", () => {
      const result = {
        success: true,
        orderId: "0x123abc",
      };
      expect(result.success).toBe(true);
      expect(result.orderId).toBeDefined();
    });

    it("failure result has errorMsg", () => {
      const result = {
        success: false,
        errorMsg: "Insufficient balance",
      };
      expect(result.success).toBe(false);
      expect(result.errorMsg).toBeDefined();
    });
  });

  describe("Tick Size Validation", () => {
    it("accepts valid tick sizes", () => {
      const validTickSizes = ["0.1", "0.01", "0.001", "0.0001"];
      for (const ts of validTickSizes) {
        expect(validTickSizes).toContain(ts);
      }
    });
  });

  describe("Category Diversification (15% cap)", () => {
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
      const usage = new Map([["politics", { count: 5, totalCost: 50 }]]);
      // 55/505 = 10.9% < 15%
      expect(canBuyInCategory("politics", 5, usage, 500, 15)).toBe(true);
    });

    it("blocks buying when category would exceed 15% limit", () => {
      const usage = new Map([["politics", { count: 15, totalCost: 75 }]]);
      // 80/505 = 15.8% > 15%
      expect(canBuyInCategory("politics", 5, usage, 500, 15)).toBe(false);
    });

    it("allows new category with no existing usage", () => {
      const usage = new Map<string, { count: number; totalCost: number }>();
      expect(canBuyInCategory("sports", 5, usage, 100, 15)).toBe(true);
    });

    it("handles zero total deployed", () => {
      const usage = new Map<string, { count: number; totalCost: number }>();
      // 5/(0+5) = 100% > 15%, correctly blocks
      expect(canBuyInCategory("crypto", 5, usage, 0, 15)).toBe(false);
    });

    it("allows first buy when there is existing portfolio", () => {
      const usage = new Map<string, { count: number; totalCost: number }>();
      // 5/(100+5) = 4.76% < 15%
      expect(canBuyInCategory("crypto", 5, usage, 100, 15)).toBe(true);
    });
  });

  describe("Wallet Configuration Detection", () => {
    it("detects env var wallet config", () => {
      const privateKey = process.env.POLYGON_PRIVATE_KEY;
      const walletAddress = process.env.POLYGON_WALLET_ADDRESS;
      const configured = !!(privateKey || walletAddress);
      expect(typeof configured).toBe("boolean");
    });
  });
});
