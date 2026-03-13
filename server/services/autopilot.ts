/**
 * Autopilot Engine
 * The autonomous scan → evaluate → buy loop that runs continuously.
 * This is what makes the bot operate like planktonXD's setup.
 * 
 * Loop cycle:
 * 1. Scan Gamma API for cheap outcomes
 * 2. AI-evaluate new discoveries
 * 3. Filter by score, risk limits, category diversification
 * 4. Calculate smart bet size ($5-$25 based on confidence)
 * 5. Place orders in bulk with rate limiting
 * 6. Check resolved markets and update P&L
 * 7. Sleep until next cycle
 */

import { scanForCheapOutcomes, analyzeOrderbook } from "./gammaApi";
import { evaluateBatch } from "./aiEvaluator";
import { placeLimitOrder, initializeClobClient, getClobStatus } from "./clobTrader";
import type { TickSize as ClobTickSize } from "@polymarket/clob-client";
import type { ParsedCheapOutcome } from "./gammaApi";
import * as db from "../db";
import { DEFAULT_RISK_CONFIG } from "@shared/botTypes";

// ===== Autopilot State =====
let isRunning = false;
let loopTimer: ReturnType<typeof setTimeout> | null = null;
let lastRunAt: Date | null = null;
let nextRunAt: Date | null = null;
let lastRunStats: AutopilotRunStats | null = null;

export interface AutopilotRunStats {
  startedAt: Date;
  completedAt: Date;
  marketsScanned: number;
  cheapFound: number;
  newDiscovered: number;
  aiEvaluated: number;
  approved: number;
  ordersPlaced: number;
  totalSpent: number;
  resolutionsChecked: number;
  wins: number;
  losses: number;
  errors: string[];
}

export function getAutopilotStatus() {
  return {
    isRunning,
    lastRunAt: lastRunAt?.toISOString() || null,
    nextRunAt: nextRunAt?.toISOString() || null,
    lastRunStats,
  };
}

// ===== Smart Bet Sizing =====
/**
 * Calculate bet size based on AI confidence score.
 * Score 1-4: skip (below threshold)
 * Score 5-6: $5 (minimum bet, low confidence)
 * Score 7: $8
 * Score 8: $12
 * Score 9: $18
 * Score 10: $25 (max bet, highest confidence)
 * 
 * Also scales down if approaching daily budget or capital limits.
 */
function calculateBetSize(
  aiScore: number,
  maxPerEvent: number,
  remainingDailyBudget: number,
  remainingCapital: number,
): number {
  // Base size from AI score
  const scoreSizeMap: Record<number, number> = {
    5: 5, 6: 5, 7: 8, 8: 12, 9: 18, 10: 25,
  };
  let baseSize = scoreSizeMap[Math.round(aiScore)] || 5;

  // Cap at max per event
  baseSize = Math.min(baseSize, maxPerEvent);

  // Scale down if running low on budget
  if (remainingDailyBudget < baseSize * 2) {
    baseSize = Math.min(baseSize, Math.floor(remainingDailyBudget / 2));
  }
  if (remainingCapital < baseSize * 2) {
    baseSize = Math.min(baseSize, Math.floor(remainingCapital / 2));
  }

  // Minimum viable bet
  return Math.max(1, baseSize);
}

// ===== Category Diversification Check =====
async function getCategoryUsage(): Promise<Map<string, { count: number; totalCost: number }>> {
  const openPositions = await db.getPositions("open");
  const catMap = new Map<string, { count: number; totalCost: number }>();
  for (const p of openPositions) {
    const cat = p.category || "other";
    const existing = catMap.get(cat) || { count: 0, totalCost: 0 };
    catMap.set(cat, {
      count: existing.count + 1,
      totalCost: existing.totalCost + parseFloat(p.costBasis),
    });
  }
  return catMap;
}

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

// ===== Resolution Tracker =====
/**
 * Check all open positions for resolution.
 * Polymarket markets resolve when the event outcome is determined.
 * We check by re-fetching the market data and looking at the price.
 * Price = 1.00 means YES resolved, Price = 0.00 means NO resolved.
 */
async function checkResolutions(): Promise<{ wins: number; losses: number; checked: number }> {
  const openPositions = await db.getPositions("open");
  let wins = 0, losses = 0, checked = 0;

  for (const pos of openPositions) {
    try {
      // Check if the market end date has passed
      if (pos.endDate && new Date(pos.endDate) > new Date()) {
        // Not yet resolved, but update current price from orderbook
        try {
          const ob = await analyzeOrderbook(pos.tokenId);
          if (ob.bestBid !== null) {
            await db.updatePositionPrice(pos.id, ob.bestBid);
          }
        } catch {
          // Orderbook fetch failed, skip price update
        }
        continue;
      }

      // Market end date has passed - check resolution
      // Fetch current market price to determine resolution
      const ob = await analyzeOrderbook(pos.tokenId);
      checked++;

      if (ob.bestBid !== null && ob.bestBid >= 0.95) {
        // Resolved YES - we won!
        await db.resolvePosition(pos.id, true);
        wins++;
      } else if (ob.bestBid !== null && ob.bestBid <= 0.05) {
        // Resolved NO - we lost
        await db.resolvePosition(pos.id, false);
        losses++;
      } else if (ob.bidDepth === 0 && ob.askDepth === 0) {
        // No orderbook at all - likely resolved, check if past end date
        if (pos.endDate && new Date(pos.endDate) < new Date(Date.now() - 24 * 60 * 60 * 1000)) {
          // More than 24h past end date with no orderbook = resolved loss
          await db.resolvePosition(pos.id, false);
          losses++;
        }
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.error(`[Autopilot] Resolution check error for position ${pos.id}:`, err);
    }
  }

  return { wins, losses, checked };
}

// ===== Main Autopilot Loop =====
async function runCycle(): Promise<AutopilotRunStats> {
  const stats: AutopilotRunStats = {
    startedAt: new Date(),
    completedAt: new Date(),
    marketsScanned: 0,
    cheapFound: 0,
    newDiscovered: 0,
    aiEvaluated: 0,
    approved: 0,
    ordersPlaced: 0,
    totalSpent: 0,
    resolutionsChecked: 0,
    wins: 0,
    losses: 0,
    errors: [],
  };

  try {
    // Load config
    const configRows = await db.getAllConfig();
    const configMap = new Map(configRows.map(c => [c.key, c.value]));

    // Check kill switch
    if (configMap.get("killSwitch") === "true") {
      stats.errors.push("Kill switch is active");
      stats.completedAt = new Date();
      return stats;
    }

    // Check bot enabled
    if (configMap.get("botEnabled") !== "true") {
      stats.errors.push("Bot is not enabled");
      stats.completedAt = new Date();
      return stats;
    }

    const maxTotalCapital = parseFloat(configMap.get("maxTotalCapital") || String(DEFAULT_RISK_CONFIG.maxTotalCapital));
    const maxPerEvent = parseFloat(configMap.get("maxPerEvent") || String(DEFAULT_RISK_CONFIG.maxPerEvent));
    const maxCategoryPercent = parseFloat(configMap.get("maxCategoryPercent") || String(DEFAULT_RISK_CONFIG.maxCategoryPercent));
    const dailyBuyBudget = parseFloat(configMap.get("dailyBuyBudget") || String(DEFAULT_RISK_CONFIG.dailyBuyBudget));
    const minPrice = parseFloat(configMap.get("minPrice") || String(DEFAULT_RISK_CONFIG.minPrice));
    const maxPrice = parseFloat(configMap.get("maxPrice") || String(DEFAULT_RISK_CONFIG.maxPrice));
    const minLiquidity = parseFloat(configMap.get("minLiquidity") || String(DEFAULT_RISK_CONFIG.minLiquidity));
    const minHours = parseFloat(configMap.get("minHoursToResolution") || String(DEFAULT_RISK_CONFIG.minHoursToResolution));
    const minAiScore = parseFloat(configMap.get("minAiScore") || String(DEFAULT_RISK_CONFIG.minAiScore));
    const scanPages = parseInt(configMap.get("autopilotScanPages") || "30");

    // ===== STEP 1: Check resolutions first =====
    console.log("[Autopilot] Step 1: Checking resolutions...");
    const resolutions = await checkResolutions();
    stats.resolutionsChecked = resolutions.checked;
    stats.wins = resolutions.wins;
    stats.losses = resolutions.losses;

    // ===== STEP 2: Calculate remaining budgets =====
    const dashStats = await db.getDashboardStats();
    const totalDeployed = dashStats?.totalCapitalDeployed || 0;
    const remainingCapital = maxTotalCapital - totalDeployed;
    const dailySpent = dashStats?.dailySpent || 0;
    const remainingDailyBudget = dailyBuyBudget - dailySpent;

    if (remainingCapital <= 0) {
      stats.errors.push(`Capital limit reached: $${totalDeployed.toFixed(2)} / $${maxTotalCapital}`);
      stats.completedAt = new Date();
      await logCycle(stats);
      return stats;
    }
    if (remainingDailyBudget <= 0) {
      stats.errors.push(`Daily budget exhausted: $${dailySpent.toFixed(2)} / $${dailyBuyBudget}`);
      stats.completedAt = new Date();
      await logCycle(stats);
      return stats;
    }

    // ===== STEP 3: Scan for cheap outcomes =====
    console.log(`[Autopilot] Step 2: Scanning ${scanPages} pages for cheap outcomes...`);
    const cheapOutcomes = await scanForCheapOutcomes(minPrice, maxPrice, minLiquidity, minHours, scanPages);
    stats.marketsScanned = scanPages * 100;
    stats.cheapFound = cheapOutcomes.length;

    // Upsert into database
    let newCount = 0;
    for (const r of cheapOutcomes) {
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
    stats.newDiscovered = newCount;

    // ===== STEP 4: AI evaluate unevaluated events =====
    console.log("[Autopilot] Step 3: AI evaluating new discoveries...");
    const unevaluated = await db.getUnevaluatedEvents(60);
    if (unevaluated.length > 0) {
      const outcomes: ParsedCheapOutcome[] = unevaluated.map(e => ({
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

      const aiResults = await evaluateBatch(outcomes);
      let evaluated = 0;
      for (const event of unevaluated) {
        const key = event.marketId + "_0";
        const result = aiResults.get(key);
        if (result) {
          await db.updateScannedEventAi(event.id, result.score, result.reasoning);
          evaluated++;
        }
      }
      stats.aiEvaluated = evaluated;
    }

    // ===== STEP 5: Select events for buying =====
    console.log("[Autopilot] Step 4: Selecting events for bulk ordering...");
    const approvedEvents = await db.getScannedEvents({
      status: "evaluated",
      minAiScore: minAiScore,
      limit: 200,
    });

    // Also get already-ordered market IDs to avoid duplicates
    const existingPositions = await db.getPositions();
    const existingMarketIds = new Set(existingPositions.map(p => p.marketId));

    // Filter out already-bought events
    const buyable = approvedEvents.filter(e =>
      !existingMarketIds.has(e.marketId) &&
      e.tokenId &&
      parseFloat(e.aiScore || "0") >= minAiScore
    );
    stats.approved = buyable.length;

    // ===== STEP 6: Place orders with smart sizing =====
    console.log(`[Autopilot] Step 5: Placing orders on ${Math.min(buyable.length, 50)} events...`);
    const categoryUsage = await getCategoryUsage();
    let currentDailySpent = dailySpent;
    let currentTotalDeployed = totalDeployed;

    // Limit to 50 orders per cycle to avoid overwhelming the system
    const maxOrdersPerCycle = parseInt(configMap.get("autopilotMaxOrders") || "50");
    const toBuy = buyable.slice(0, maxOrdersPerCycle);

    for (const event of toBuy) {
      // Check budgets
      const currentRemainingDaily = dailyBuyBudget - currentDailySpent;
      const currentRemainingCapital = maxTotalCapital - currentTotalDeployed;
      if (currentRemainingDaily <= 1 || currentRemainingCapital <= 1) break;

      // Check category limit
      const category = event.category || "other";
      if (!canBuyInCategory(category, 5, categoryUsage, currentTotalDeployed, maxCategoryPercent)) {
        continue;
      }

      // Smart bet sizing
      const aiScore = parseFloat(event.aiScore || "5");
      const betSize = calculateBetSize(aiScore, maxPerEvent, currentRemainingDaily, currentRemainingCapital);
      if (betSize < 1) continue;

      try {
        // Check orderbook
        const ob = await analyzeOrderbook(event.tokenId!);
        if (!ob.fillableAtPrice || ob.bestAsk === null || ob.bestAsk > parseFloat(event.price) * 1.5) {
          continue; // Skip if no asks or price moved too much
        }

        const price = ob.bestAsk;
        const shares = betSize / price;

        // Create order
        const orderId = await db.createOrder({
          scannedEventId: event.id,
          marketId: event.marketId,
          tokenId: event.tokenId!,
          side: "BUY",
          price: String(price),
          size: String(shares),
          amountUsd: String(betSize),
          status: "pending",
        });

        // Check if wallet is configured for live trading
        const walletKey = configMap.get("walletPrivateKey") || process.env.POLYGON_PRIVATE_KEY;
        if (!walletKey) {
          // Simulated mode
          await db.updateOrderStatus(orderId!, "pending", "Simulated - wallet not configured");
        } else {
          // Live CLOB order placement
          try {
            const clobStatus = getClobStatus();
            if (!clobStatus.initialized) {
              await initializeClobClient();
            }

            const tickSize = (event.tickSize || "0.01") as ClobTickSize;
            const result = await placeLimitOrder(
              event.tokenId!,
              price,
              shares,
              tickSize,
              event.negRisk || false,
            );

            if (result.success) {
              await db.updateOrderStatus(orderId!, "placed", `CLOB order: ${result.orderId}`);
              await db.createScanLog({
                action: "clob_order",
                details: `Live order placed: ${event.question.slice(0, 60)}... @ $${price.toFixed(4)} x ${shares.toFixed(1)} shares ($${betSize})`,
              });
            } else {
              await db.updateOrderStatus(orderId!, "failed", `CLOB error: ${result.errorMsg}`);
              stats.errors.push(`CLOB order failed for ${event.marketId}: ${result.errorMsg}`);
            }
          } catch (clobErr: any) {
            await db.updateOrderStatus(orderId!, "failed", `CLOB exception: ${clobErr.message}`);
            stats.errors.push(`CLOB exception for ${event.marketId}: ${clobErr.message}`);
          }
        }

        // Create position
        await db.createPosition({
          scannedEventId: event.id,
          marketId: event.marketId,
          tokenId: event.tokenId!,
          question: event.question,
          outcome: event.outcome,
          category: event.category,
          entryPrice: String(price),
          shares: String(shares),
          costBasis: String(betSize),
          currentPrice: String(price),
          currentValue: String(betSize),
          pnl: "0",
          pnlPercent: "0",
          endDate: event.endDate,
        });

        await db.updateScannedEventStatus(event.id, "ordered");

        // Update running totals
        currentDailySpent += betSize;
        currentTotalDeployed += betSize;
        stats.ordersPlaced++;
        stats.totalSpent += betSize;

        // Update category usage
        const catUsage = categoryUsage.get(category) || { count: 0, totalCost: 0 };
        categoryUsage.set(category, {
          count: catUsage.count + 1,
          totalCost: catUsage.totalCost + betSize,
        });

        // Rate limit between orders
        await new Promise(r => setTimeout(r, 300));
      } catch (err: any) {
        stats.errors.push(`Order error for ${event.marketId}: ${err.message}`);
        console.error(`[Autopilot] Order error:`, err);
      }
    }

    stats.completedAt = new Date();
    await logCycle(stats);
    return stats;

  } catch (err: any) {
    stats.errors.push(`Cycle error: ${err.message}`);
    stats.completedAt = new Date();
    await logCycle(stats);
    return stats;
  }
}

async function logCycle(stats: AutopilotRunStats) {
  const duration = stats.completedAt.getTime() - stats.startedAt.getTime();
  const details = [
    `Scanned: ${stats.cheapFound} cheap outcomes`,
    `New: ${stats.newDiscovered}`,
    `AI evaluated: ${stats.aiEvaluated}`,
    `Orders: ${stats.ordersPlaced} ($${stats.totalSpent.toFixed(2)})`,
    `Resolutions: ${stats.wins}W/${stats.losses}L`,
    stats.errors.length > 0 ? `Errors: ${stats.errors.join("; ")}` : "",
  ].filter(Boolean).join(" | ");

  await db.createScanLog({
    action: "autopilot",
    details,
    marketsScanned: stats.marketsScanned,
    cheapFound: stats.cheapFound,
    newDiscovered: stats.newDiscovered,
    ordersPlaced: stats.ordersPlaced,
    errors: stats.errors.length,
    duration,
  });
}

// ===== Start/Stop Controls =====

/**
 * Start the autopilot loop.
 * Runs immediately, then repeats at the configured interval.
 */
export async function startAutopilot(intervalHours = 4): Promise<void> {
  if (isRunning) {
    console.log("[Autopilot] Already running");
    return;
  }

  isRunning = true;
  console.log(`[Autopilot] Starting with ${intervalHours}h interval`);

  const runAndSchedule = async () => {
    if (!isRunning) return;

    lastRunAt = new Date();
    try {
      lastRunStats = await runCycle();
    } catch (err) {
      console.error("[Autopilot] Unhandled cycle error:", err);
    }

    if (isRunning) {
      const intervalMs = intervalHours * 60 * 60 * 1000;
      nextRunAt = new Date(Date.now() + intervalMs);
      loopTimer = setTimeout(runAndSchedule, intervalMs);
    }
  };

  // Run first cycle immediately
  await runAndSchedule();
}

/**
 * Stop the autopilot loop.
 */
export function stopAutopilot(): void {
  isRunning = false;
  if (loopTimer) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }
  nextRunAt = null;
  console.log("[Autopilot] Stopped");
}

/**
 * Run a single cycle manually (doesn't start the loop).
 */
export async function runSingleCycle(): Promise<AutopilotRunStats> {
  lastRunAt = new Date();
  lastRunStats = await runCycle();
  return lastRunStats;
}
