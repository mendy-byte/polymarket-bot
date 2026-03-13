import { COOKIE_NAME } from "@shared/const";
import { DEFAULT_RISK_CONFIG } from "@shared/botTypes";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { scanForCheapOutcomes, analyzeOrderbook } from "./services/gammaApi";
import { evaluateBatch, evaluateSingle } from "./services/aiEvaluator";
import { startAutopilot, stopAutopilot, runSingleCycle, getAutopilotStatus } from "./services/autopilot";
import { initializeClobClient, getClobStatus, placeLimitOrder, cancelAllOrders, getOpenOrders, shutdownClob, checkOrderFills } from "./services/clobTrader";
import type { TickSize as ClobTickSize } from "@polymarket/clob-client";
import type { ParsedCheapOutcome } from "./services/gammaApi";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ===== Dashboard =====
  dashboard: router({
    stats: protectedProcedure.query(async () => {
      const stats = await db.getDashboardStats();
      const configRows = await db.getAllConfig();
      const configMap = new Map(configRows.map(c => [c.key, c.value]));
      const dailyBudget = parseFloat(configMap.get("dailyBuyBudget") || String(DEFAULT_RISK_CONFIG.dailyBuyBudget));
      const maxCapital = parseFloat(configMap.get("maxTotalCapital") || String(DEFAULT_RISK_CONFIG.maxTotalCapital));
      return {
        ...stats,
        remainingBudget: dailyBudget - (stats?.dailySpent || 0),
        maxCapital,
        killSwitch: configMap.get("killSwitch") === "true",
        botEnabled: configMap.get("botEnabled") === "true",
      };
    }),
    recentLogs: protectedProcedure.query(async () => {
      return db.getRecentLogs(50);
    }),
    fillStats: protectedProcedure.query(async () => {
      return db.getOrderFillStats();
    }),
  }),

  // ===== Scanner =====
  scanner: router({
    scan: protectedProcedure.input(z.object({
      minPrice: z.number().optional(),
      maxPrice: z.number().optional(),
      minLiquidity: z.number().optional(),
      minHoursToResolution: z.number().optional(),
      maxPages: z.number().optional(),
    }).optional()).mutation(async ({ input }) => {
      const configRows = await db.getAllConfig();
      const configMap = new Map(configRows.map(c => [c.key, c.value]));

      const minPrice = input?.minPrice ?? parseFloat(configMap.get("minPrice") || String(DEFAULT_RISK_CONFIG.minPrice));
      const maxPrice = input?.maxPrice ?? parseFloat(configMap.get("maxPrice") || String(DEFAULT_RISK_CONFIG.maxPrice));
      const minLiquidity = input?.minLiquidity ?? parseFloat(configMap.get("minLiquidity") || String(DEFAULT_RISK_CONFIG.minLiquidity));
      const minHours = input?.minHoursToResolution ?? parseFloat(configMap.get("minHoursToResolution") || String(DEFAULT_RISK_CONFIG.minHoursToResolution));
      const maxPages = input?.maxPages ?? 20;

      const startTime = Date.now();
      const results = await scanForCheapOutcomes(minPrice, maxPrice, minLiquidity, minHours, maxPages);

      let newCount = 0;
      for (const r of results) {
        const id = await db.upsertScannedEvent({
          marketId: r.marketId,
          conditionId: r.conditionId,
          tokenId: r.tokenId,
          question: r.question,
          outcome: r.outcome,
          slug: r.slug,
          eventSlug: r.eventSlug,
          category: r.category,
          tags: r.tags,
          price: String(r.price),
          liquidity: String(r.liquidity),
          volume: String(r.volume),
          endDate: new Date(r.endDate),
          hoursToResolution: r.hoursToResolution,
          tickSize: String(r.tickSize),
          minOrderSize: r.minOrderSize,
          negRisk: r.negRisk,
        });
        if (id) newCount++;
      }

      const duration = Date.now() - startTime;
      await db.createScanLog({
        action: "scan",
        details: `Scanned ${maxPages} pages, found ${results.length} cheap outcomes, ${newCount} new/updated`,
        marketsScanned: maxPages * 100,
        cheapFound: results.length,
        newDiscovered: newCount,
        duration,
      });

      return { total: results.length, newOrUpdated: newCount, duration };
    }),

    events: protectedProcedure.input(z.object({
      status: z.string().optional(),
      minAiScore: z.number().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    }).optional()).query(async ({ input }) => {
      return db.getScannedEvents({
        status: input?.status,
        minAiScore: input?.minAiScore,
        limit: input?.limit || 100,
        offset: input?.offset || 0,
      });
    }),

    evaluate: protectedProcedure.input(z.object({
      eventIds: z.array(z.number()).optional(),
      autoEvaluate: z.boolean().optional(),
    }).optional()).mutation(async ({ input }) => {
      let events;
      if (input?.eventIds && input.eventIds.length > 0) {
        const allEvents = await db.getScannedEvents({ limit: 1000 });
        events = allEvents.filter(e => input.eventIds!.includes(e.id));
      } else {
        events = await db.getUnevaluatedEvents(input?.autoEvaluate ? 40 : 20);
      }

      if (events.length === 0) return { evaluated: 0 };

      const outcomes: ParsedCheapOutcome[] = events.map(e => ({
        marketId: e.marketId,
        conditionId: e.conditionId || "",
        tokenId: e.tokenId || "",
        question: e.question,
        outcome: e.outcome,
        outcomeIndex: 0,
        price: parseFloat(e.price),
        liquidity: parseFloat(e.liquidity || "0"),
        volume: parseFloat(e.volume || "0"),
        endDate: e.endDate?.toISOString() || "",
        slug: e.slug || "",
        eventSlug: e.eventSlug || "",
        eventTitle: "",
        tags: (e.tags as any) || [],
        category: e.category || "other",
        tickSize: parseFloat(e.tickSize || "0.01"),
        minOrderSize: e.minOrderSize || 5,
        negRisk: e.negRisk || false,
        hoursToResolution: e.hoursToResolution || 0,
      }));

      const results = await evaluateBatch(outcomes);

      let evaluated = 0;
      for (const event of events) {
        const key = event.marketId + "_0";
        const result = results.get(key);
        if (result) {
          await db.updateScannedEventAi(event.id, result.score, result.reasoning);
          evaluated++;
        }
      }

      await db.createScanLog({
        action: "evaluate",
        details: `AI evaluated ${evaluated} events`,
        cheapFound: evaluated,
      });

      return { evaluated };
    }),

    orderbook: protectedProcedure.input(z.object({
      tokenId: z.string(),
    })).query(async ({ input }) => {
      return analyzeOrderbook(input.tokenId);
    }),
  }),

  // ===== Portfolio =====
  portfolio: router({
    positions: protectedProcedure.input(z.object({
      status: z.string().optional(),
    }).optional()).query(async ({ input }) => {
      return db.getPositions(input?.status);
    }),
    orders: protectedProcedure.input(z.object({
      status: z.string().optional(),
    }).optional()).query(async ({ input }) => {
      return db.getOrders(input?.status);
    }),
    resolvedSummary: protectedProcedure.query(async () => {
      return db.getResolvedPositionsSummary();
    }),
    placeOrder: protectedProcedure.input(z.object({
      scannedEventId: z.number(),
      amountUsd: z.number().min(0.05).max(25),
    })).mutation(async ({ input }) => {
      // Get config for risk checks
      const configRows = await db.getAllConfig();
      const configMap = new Map(configRows.map(c => [c.key, c.value]));

      if (configMap.get("killSwitch") === "true") {
        throw new Error("Kill switch is active. No orders can be placed.");
      }
      if (configMap.get("botEnabled") !== "true") {
        throw new Error("Bot is not enabled. Enable it in settings first.");
      }

      const maxPerEvent = parseFloat(configMap.get("maxPerEvent") || String(DEFAULT_RISK_CONFIG.maxPerEvent));
      if (input.amountUsd > maxPerEvent) {
        throw new Error(`Amount exceeds max per event limit of $${maxPerEvent}`);
      }

      // Get the scanned event
      const events = await db.getScannedEvents({ limit: 1000 });
      const event = events.find(e => e.id === input.scannedEventId);
      if (!event) throw new Error("Event not found");
      if (!event.tokenId) throw new Error("No token ID for this event");

      // Check orderbook
      const ob = await analyzeOrderbook(event.tokenId);
      if (!ob.fillableAtPrice || ob.bestAsk === null) {
        throw new Error("No asks available in orderbook");
      }

      const price = ob.bestAsk;
      const shares = input.amountUsd / price;

      // Create order record (actual CLOB placement requires wallet config)
      const orderId = await db.createOrder({
        scannedEventId: event.id,
        marketId: event.marketId,
        tokenId: event.tokenId,
        side: "BUY",
        price: String(price),
        size: String(shares),
        amountUsd: String(input.amountUsd),
        status: "pending",
      });

      // Check if wallet is configured
      const walletKey = configMap.get("walletPrivateKey");
      if (!walletKey) {
        await db.updateOrderStatus(orderId!, "pending", "Wallet not configured - order saved but not placed on CLOB");

        // Still create a simulated position for tracking
        await db.createPosition({
          scannedEventId: event.id,
          marketId: event.marketId,
          tokenId: event.tokenId,
          question: event.question,
          outcome: event.outcome,
          category: event.category,
          entryPrice: String(price),
          shares: String(shares),
          costBasis: String(input.amountUsd),
          currentPrice: String(price),
          currentValue: String(input.amountUsd),
          pnl: "0",
          pnlPercent: "0",
          endDate: event.endDate,
        });

        await db.updateScannedEventStatus(event.id, "ordered");

        return {
          orderId,
          status: "simulated",
          message: "Order recorded (simulated). Configure wallet for live CLOB trading.",
          price,
          shares,
          cost: input.amountUsd,
        };
      }

      // With wallet configured, attempt live CLOB placement
      try {
        const clobStatus = getClobStatus();
        if (!clobStatus.initialized) {
          await initializeClobClient();
        }

        const tickSize = (event.tickSize || "0.01") as ClobTickSize;
        const clobResult = await placeLimitOrder(
          event.tokenId,
          price,
          shares,
          tickSize,
          event.negRisk || false,
        );

        if (!clobResult.success) {
          await db.updateOrderStatus(orderId!, "failed", `CLOB: ${clobResult.errorMsg}`);
          throw new Error(`CLOB order failed: ${clobResult.errorMsg}`);
        }

        await db.updateOrderStatus(orderId!, "placed", `CLOB order: ${clobResult.orderId}`);
        await db.createPosition({
          scannedEventId: event.id,
          marketId: event.marketId,
          tokenId: event.tokenId,
          question: event.question,
          outcome: event.outcome,
          category: event.category,
          entryPrice: String(price),
          shares: String(shares),
          costBasis: String(input.amountUsd),
          currentPrice: String(price),
          currentValue: String(input.amountUsd),
          pnl: "0",
          pnlPercent: "0",
          endDate: event.endDate,
        });
        await db.updateScannedEventStatus(event.id, "ordered");

        return {
          orderId,
          status: "placed",
          message: "Order placed on CLOB",
          price,
          shares,
          cost: input.amountUsd,
        };
      } catch (err: any) {
        await db.updateOrderStatus(orderId!, "failed", err.message);
        throw new Error(`CLOB order failed: ${err.message}`);
      }
    }),
  }),

  // ===== Risk Controls =====
  risk: router({
    config: protectedProcedure.query(async () => {
      const configRows = await db.getAllConfig();
      const configMap = new Map(configRows.map(c => [c.key, c.value]));
      return {
        maxTotalCapital: parseFloat(configMap.get("maxTotalCapital") || String(DEFAULT_RISK_CONFIG.maxTotalCapital)),
        maxPerEvent: parseFloat(configMap.get("maxPerEvent") || String(DEFAULT_RISK_CONFIG.maxPerEvent)),
        maxCategoryPercent: parseFloat(configMap.get("maxCategoryPercent") || String(DEFAULT_RISK_CONFIG.maxCategoryPercent)),
        dailyBuyBudget: parseFloat(configMap.get("dailyBuyBudget") || String(DEFAULT_RISK_CONFIG.dailyBuyBudget)),
        minPrice: parseFloat(configMap.get("minPrice") || String(DEFAULT_RISK_CONFIG.minPrice)),
        maxPrice: parseFloat(configMap.get("maxPrice") || String(DEFAULT_RISK_CONFIG.maxPrice)),
        minLiquidity: parseFloat(configMap.get("minLiquidity") || String(DEFAULT_RISK_CONFIG.minLiquidity)),
        minHoursToResolution: parseFloat(configMap.get("minHoursToResolution") || String(DEFAULT_RISK_CONFIG.minHoursToResolution)),
        minAiScore: parseFloat(configMap.get("minAiScore") || String(DEFAULT_RISK_CONFIG.minAiScore)),
        killSwitch: configMap.get("killSwitch") === "true",
        botEnabled: configMap.get("botEnabled") === "true",
        walletConfigured: !!configMap.get("walletPrivateKey"),
        walletAddress: configMap.get("walletAddress") || "",
        clobApiKey: configMap.get("clobApiKey") ? "configured" : "",
      };
    }),
    updateConfig: protectedProcedure.input(z.object({
      key: z.string(),
      value: z.string(),
    })).mutation(async ({ input }) => {
      await db.setConfig(input.key, input.value);
      return { success: true };
    }),
    killSwitch: protectedProcedure.input(z.object({
      enabled: z.boolean(),
    })).mutation(async ({ input }) => {
      await db.setConfig("killSwitch", String(input.enabled), "Emergency kill switch");
      if (input.enabled) {
        await db.createScanLog({ action: "kill_switch", details: "Kill switch ACTIVATED" });
      } else {
        await db.createScanLog({ action: "kill_switch", details: "Kill switch deactivated" });
      }
      return { success: true, killSwitch: input.enabled };
    }),
    toggleBot: protectedProcedure.input(z.object({
      enabled: z.boolean(),
    })).mutation(async ({ input }) => {
      await db.setConfig("botEnabled", String(input.enabled), "Bot enabled/disabled");
      await db.createScanLog({ action: "bot_toggle", details: `Bot ${input.enabled ? "enabled" : "disabled"}` });
      return { success: true, botEnabled: input.enabled };
    }),
    categoryBreakdown: protectedProcedure.query(async () => {
      const positions = await db.getPositions("open");
      const configRows = await db.getAllConfig();
      const configMap = new Map(configRows.map(c => [c.key, c.value]));
      const maxCategoryPercent = parseFloat(configMap.get("maxCategoryPercent") || String(DEFAULT_RISK_CONFIG.maxCategoryPercent));

      const categoryMap = new Map<string, { count: number; totalCost: number }>();
      let totalCost = 0;
      for (const p of positions) {
        const cat = p.category || "other";
        const cost = parseFloat(p.costBasis);
        totalCost += cost;
        const existing = categoryMap.get(cat) || { count: 0, totalCost: 0 };
        categoryMap.set(cat, { count: existing.count + 1, totalCost: existing.totalCost + cost });
      }

      return Array.from(categoryMap.entries()).map(([category, data]) => ({
        category,
        count: data.count,
        totalCost: data.totalCost,
        percentage: totalCost > 0 ? (data.totalCost / totalCost) * 100 : 0,
        limit: maxCategoryPercent,
      })).sort((a, b) => b.totalCost - a.totalCost);
    }),
  }),

  // ===== Autopilot =====
  autopilot: router({
    status: protectedProcedure.query(async () => {
      const status = getAutopilotStatus();
      const configRows = await db.getAllConfig();
      const configMap = new Map(configRows.map(c => [c.key, c.value]));
      return {
        ...status,
        intervalHours: parseFloat(configMap.get("autopilotInterval") || "2"),
        maxOrdersPerCycle: parseInt(configMap.get("autopilotMaxOrders") || "50"),
        scanPages: parseInt(configMap.get("autopilotScanPages") || "75"),
        autopilotEnabled: configMap.get("autopilotEnabled") === "true",
      };
    }),
    start: protectedProcedure.input(z.object({
      intervalHours: z.number().min(1).max(24).optional(),
    }).optional()).mutation(async ({ input }) => {
      const configRows = await db.getAllConfig();
      const configMap = new Map(configRows.map(c => [c.key, c.value]));

      if (configMap.get("killSwitch") === "true") {
        throw new Error("Cannot start autopilot: kill switch is active");
      }
      if (configMap.get("botEnabled") !== "true") {
        throw new Error("Cannot start autopilot: bot is not enabled. Enable it in Risk Controls first.");
      }

      const interval = input?.intervalHours || parseFloat(configMap.get("autopilotInterval") || "2");
      await db.setConfig("autopilotEnabled", "true", "Autopilot enabled");
      await db.setConfig("autopilotInterval", String(interval), "Autopilot interval in hours");
      await startAutopilot(interval);
      await db.createScanLog({ action: "autopilot_start", details: `Autopilot started with ${interval}h interval` });
      return { success: true, interval };
    }),
    stop: protectedProcedure.mutation(async () => {
      stopAutopilot();
      await db.setConfig("autopilotEnabled", "false", "Autopilot disabled");
      await db.createScanLog({ action: "autopilot_stop", details: "Autopilot stopped" });
      return { success: true };
    }),
    runOnce: protectedProcedure.mutation(async () => {
      const configRows = await db.getAllConfig();
      const configMap = new Map(configRows.map(c => [c.key, c.value]));

      if (configMap.get("killSwitch") === "true") {
        throw new Error("Cannot run cycle: kill switch is active");
      }
      if (configMap.get("botEnabled") !== "true") {
        throw new Error("Cannot run cycle: bot is not enabled");
      }

      const stats = await runSingleCycle();
      return stats;
    }),
    updateConfig: protectedProcedure.input(z.object({
      intervalHours: z.number().min(1).max(24).optional(),
      maxOrdersPerCycle: z.number().min(1).max(200).optional(),
      scanPages: z.number().min(5).max(100).optional(),
    })).mutation(async ({ input }) => {
      if (input.intervalHours !== undefined) {
        await db.setConfig("autopilotInterval", String(input.intervalHours), "Autopilot interval in hours");
      }
      if (input.maxOrdersPerCycle !== undefined) {
        await db.setConfig("autopilotMaxOrders", String(input.maxOrdersPerCycle), "Max orders per autopilot cycle");
      }
      if (input.scanPages !== undefined) {
        await db.setConfig("autopilotScanPages", String(input.scanPages), "Pages to scan per autopilot cycle");
      }
      return { success: true };
    }),
  }),

  // ===== Wallet Config =====
  wallet: router({
    status: protectedProcedure.query(async () => {
      const configRows = await db.getAllConfig();
      const configMap = new Map(configRows.map(c => [c.key, c.value]));
      const clobStatus = getClobStatus();
      return {
        configured: !!(configMap.get("walletPrivateKey") || process.env.POLYGON_PRIVATE_KEY),
        address: configMap.get("walletAddress") || process.env.POLYGON_WALLET_ADDRESS || "",
        clobApiKey: configMap.get("clobApiKey") ? "***configured***" : "",
        clobApiSecret: configMap.get("clobApiSecret") ? "***configured***" : "",
        clobPassphrase: configMap.get("clobPassphrase") ? "***configured***" : "",
        clobInitialized: clobStatus.initialized,
        clobError: clobStatus.error,
        heartbeatActive: clobStatus.heartbeatActive,
      };
    }),
    configure: protectedProcedure.input(z.object({
      privateKey: z.string().optional(),
      walletAddress: z.string().optional(),
      clobApiKey: z.string().optional(),
      clobApiSecret: z.string().optional(),
      clobPassphrase: z.string().optional(),
    })).mutation(async ({ input }) => {
      if (input.privateKey) await db.setConfig("walletPrivateKey", input.privateKey, "Polygon wallet private key");
      if (input.walletAddress) await db.setConfig("walletAddress", input.walletAddress, "Polygon wallet address");
      if (input.clobApiKey) await db.setConfig("clobApiKey", input.clobApiKey, "CLOB API key");
      if (input.clobApiSecret) await db.setConfig("clobApiSecret", input.clobApiSecret, "CLOB API secret");
      if (input.clobPassphrase) await db.setConfig("clobPassphrase", input.clobPassphrase, "CLOB API passphrase");
      await db.createScanLog({ action: "wallet_config", details: "Wallet configuration updated" });
      return { success: true };
    }),
    deriveCreds: protectedProcedure.mutation(async () => {
      const result = await initializeClobClient();
      if (!result.success) {
        throw new Error(`Failed to derive CLOB credentials: ${result.error}`);
      }
      const configRows = await db.getAllConfig();
      const configMap = new Map(configRows.map(c => [c.key, c.value]));
      return {
        success: true,
        address: configMap.get("walletAddress") || "",
        clobApiKey: configMap.get("clobApiKey") ? "***derived***" : "",
        clobInitialized: true,
      };
    }),
    disconnect: protectedProcedure.mutation(async () => {
      shutdownClob();
      await db.createScanLog({ action: "wallet_disconnect", details: "CLOB client disconnected" });
      return { success: true };
    }),
    cancelAll: protectedProcedure.mutation(async () => {
      const result = await cancelAllOrders();
      if (result) {
        await db.createScanLog({ action: "cancel_all", details: "All open CLOB orders cancelled" });
      }
      return { success: result };
    }),
    openOrders: protectedProcedure.query(async () => {
      return getOpenOrders();
    }),
  }),
});

export type AppRouter = typeof appRouter;
