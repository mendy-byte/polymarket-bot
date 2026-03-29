import * as fs from "fs";
import * as path from "path";

// File-based logging that bypasses devserver.log buffering
const LOG_FILE = path.join(process.cwd(), "autopilot.log");
function log(msg: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  console.log(msg);
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
}

/**
 * Autopilot Engine - DIVERSIFIED STRATEGY
 * 
 * Matches planktonXD's approach: buy EVERYTHING cheap across ALL categories.
 * The math works through massive uncorrelated diversification, not intelligence.
 * 
 * Key changes from v1:
 * 1. AI is reject-only filter (score 1-2 = impossible, skip; 3+ = buy)
 * 2. Events are RANDOMLY SHUFFLED before selection (no bias toward any category)
 * 3. Hard category cap: max 15% of capital in any single category
 * 4. Event group deduplication: only 1 outcome per event group
 * 5. Flat $5 bet sizing (no "smart" sizing that creates concentration)
 * 6. Target: 200+ uncorrelated positions at $5 each
 * 
 * Loop cycle:
 * 1. Scan Gamma API for cheap outcomes
 * 2. AI-evaluate new discoveries (reject impossibles only)
 * 3. Shuffle approved events randomly
 * 4. Deduplicate within event groups
 * 5. Enforce category caps while selecting
 * 6. Place orders with flat $5 sizing
 * 7. Check resolved markets and update P&L
 * 8. Sleep until next cycle
 */

import { scanForCheapOutcomes, analyzeOrderbook, lookupMarketResolution } from "./gammaApi";
import { evaluateBatch } from "./aiEvaluator";
import { placeLimitOrder, initializeClobClient, getClobStatus, checkOrderFills } from "./clobTrader";
import type { TickSize as ClobTickSize } from "@polymarket/clob-client";
import type { ParsedCheapOutcome } from "./gammaApi";
import * as db from "../db";
import { DEFAULT_RISK_CONFIG } from "@shared/botTypes";
import { sendTelegramAlert } from "./telegram";

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
  aiRejected: number;
  approved: number;
  ordersPlaced: number;
  totalSpent: number;
  resolutionsChecked: number;
  wins: number;
  losses: number;
  categoriesUsed: number;
  categoryBreakdown: Record<string, number>;
  fillsChecked: number;
  fillsFilled: number;
  fillsCancelled: number;
  fillsOpen: number;
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

// ===== Fisher-Yates Shuffle =====
function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// ===== Timeframe-Aware Mixing =====
// Interleave short-dated (< 30 days) and long-dated events
// so each cycle gets a mix of quick-resolving and longer bets.
function mixByTimeframe<T extends { endDate?: Date | null; hoursToResolution?: number | null }>(events: T[]): T[] {
  const SHORT_HOURS = 30 * 24; // 30 days
  const shortDated: T[] = [];
  const longDated: T[] = [];

  for (const e of events) {
    const hours = e.hoursToResolution || (e.endDate ? (new Date(e.endDate).getTime() - Date.now()) / (1000 * 60 * 60) : Infinity);
    if (hours <= SHORT_HOURS) {
      shortDated.push(e);
    } else {
      longDated.push(e);
    }
  }

  // Shuffle each bucket independently
  const shuffledShort = shuffleArray(shortDated);
  const shuffledLong = shuffleArray(longDated);

  // Interleave: 4 short, 1 long (planktonXD-style heavy short-dated focus)
  const mixed: T[] = [];
  let si = 0, li = 0;
  while (si < shuffledShort.length || li < shuffledLong.length) {
    if (si < shuffledShort.length) mixed.push(shuffledShort[si++]);
    if (si < shuffledShort.length) mixed.push(shuffledShort[si++]);
    if (si < shuffledShort.length) mixed.push(shuffledShort[si++]);
    if (si < shuffledShort.length) mixed.push(shuffledShort[si++]);
    if (li < shuffledLong.length) mixed.push(shuffledLong[li++]);
  }

  log(`[Autopilot] Timeframe mix: ${shuffledShort.length} short-dated (<30d), ${shuffledLong.length} long-dated`);
  return mixed;
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

// ===== Event Group Deduplication =====
const MAX_POSITIONS_PER_EVENT_GROUP = 2;

/**
 * Build a map of how many positions we already hold per event group.
 * Looks up eventSlug from scanned_events table for each existing position.
 */
async function getExistingEventGroupCounts(): Promise<Map<string, number>> {
  const openPositions = await db.getPositions("open");
  const scannedEventIds = openPositions.map(p => p.scannedEventId).filter(Boolean);
  const slugMap = await db.getEventSlugsForPositions(scannedEventIds);
  
  const groupCounts = new Map<string, number>();
  for (const pos of openPositions) {
    const slug = slugMap.get(pos.scannedEventId) || pos.marketId;
    groupCounts.set(slug, (groupCounts.get(slug) || 0) + 1);
  }
  return groupCounts;
}

/**
 * Filter candidates to respect max positions per event group.
 * Checks BOTH existing positions AND within the current batch.
 * This prevents buying 16 outcomes from the same "2028 US Presidential Election" event.
 */
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

// ===== Resolution Tracker =====
async function checkResolutions(): Promise<{ wins: number; losses: number; checked: number }> {
  log("[Autopilot] Fetching open positions...");
  const openPositions = await db.getPositions("open");
  log(`[Autopilot] Found ${openPositions.length} open positions to check`);
  let wins = 0, losses = 0, checked = 0;

  for (let i = 0; i < openPositions.length; i++) {
    const pos = openPositions[i];
    try {
      if (pos.endDate && new Date(pos.endDate) > new Date()) {
        // Future event — just update price, don't resolve
        try {
          const ob = await analyzeOrderbook(pos.tokenId);
          if (ob.bestBid !== null) {
            await db.updatePositionPrice(pos.id, ob.bestBid);
          }
        } catch {
          // skip price update errors
        }
        if ((i + 1) % 10 === 0) log(`[Autopilot] Price updated ${i + 1}/${openPositions.length}`);
        continue;
      }

      const ob = await analyzeOrderbook(pos.tokenId);
      checked++;

      // When CLOB returns an error (404 = market closed), try Gamma API for resolution
      if (ob.apiError) {
        try {
          const resolution = await lookupMarketResolution(pos.marketId);
          if (resolution && resolution.resolved) {
            const won = resolution.winningOutcome === pos.outcome;
            await db.resolvePosition(pos.id, won);
            if (won) wins++; else losses++;
            log(`[Autopilot] Resolved position ${pos.id} via Gamma: ${won ? 'WIN' : 'LOSS'} (winning=${resolution.winningOutcome}, ours=${pos.outcome})`);
          } else if (resolution && resolution.closed) {
            // Market closed but no clear winner — assume loss for tail-risk bets
            await db.resolvePosition(pos.id, false);
            losses++;
            log(`[Autopilot] Resolved position ${pos.id} as LOSS (market closed, no clear winner)`);
          } else {
            log(`[Autopilot] Skipping position ${pos.id} — API error but market not resolved yet`);
          }
        } catch (gammaErr) {
          log(`[Autopilot] Skipping position ${pos.id} — both CLOB and Gamma API failed`);
        }
        continue;
      }

      if (ob.bestBid !== null && ob.bestBid >= 0.95) {
        await db.resolvePosition(pos.id, true);
        wins++;
      } else if (ob.bestBid !== null && ob.bestBid <= 0.05) {
        await db.resolvePosition(pos.id, false);
        losses++;
      } else if (ob.bidDepth === 0 && ob.askDepth === 0) {
        if (pos.endDate && new Date(pos.endDate) < new Date(Date.now() - 24 * 60 * 60 * 1000)) {
          await db.resolvePosition(pos.id, false);
          losses++;
        }
      }

      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      log(`[Autopilot] ERROR: Resolution check error for position ${pos.id}: ${err}`);
    }
  }

  log(`[Autopilot] Resolution check complete: ${checked} checked, ${wins} wins, ${losses} losses`);
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
    aiRejected: 0,
    approved: 0,
    ordersPlaced: 0,
    totalSpent: 0,
    resolutionsChecked: 0,
    wins: 0,
    losses: 0,
    categoriesUsed: 0,
    categoryBreakdown: {},
    fillsChecked: 0,
    fillsFilled: 0,
    fillsCancelled: 0,
    fillsOpen: 0,
    errors: [],
  };

  try {
    const configRows = await db.getAllConfig();
    const configMap = new Map(configRows.map(c => [c.key, c.value]));

    if (configMap.get("killSwitch") === "true") {
      stats.errors.push("Kill switch is active");
      stats.completedAt = new Date();
      return stats;
    }

    if (configMap.get("botEnabled") !== "true") {
      stats.errors.push("Bot is not enabled");
      stats.completedAt = new Date();
      return stats;
    }

    const maxTotalCapital = parseFloat(configMap.get("maxTotalCapital") || String(DEFAULT_RISK_CONFIG.maxTotalCapital));
    const maxPerEvent = parseFloat(configMap.get("maxPerEvent") || String(DEFAULT_RISK_CONFIG.maxPerEvent));
    const maxCategoryPercent = parseFloat(configMap.get("maxCategoryPercent") || "15");
    const dailyBuyBudget = parseFloat(configMap.get("dailyBuyBudget") || String(DEFAULT_RISK_CONFIG.dailyBuyBudget));
    const minPrice = parseFloat(configMap.get("minPrice") || String(DEFAULT_RISK_CONFIG.minPrice));
    const maxPrice = parseFloat(configMap.get("maxPrice") || String(DEFAULT_RISK_CONFIG.maxPrice));
    const minLiquidity = parseFloat(configMap.get("minLiquidity") || String(DEFAULT_RISK_CONFIG.minLiquidity));
    const minHours = parseFloat(configMap.get("minHoursToResolution") || String(DEFAULT_RISK_CONFIG.minHoursToResolution));
    const minAiScore = parseFloat(configMap.get("minAiScore") || "3");
    const scanPages = parseInt(configMap.get("autopilotScanPages") || "75");

    // Flat bet size: $5 per event (the planktonXD way)
    const flatBetSize = Math.min(5, maxPerEvent);

    // ===== STEP 1: Check resolutions =====
    log("[Autopilot] Step 1: Checking resolutions...");
    const resolutions = await checkResolutions();
    stats.resolutionsChecked = resolutions.checked;
    stats.wins = resolutions.wins;
    stats.losses = resolutions.losses;

    // ===== STEP 2: Budget check =====
    log("[Autopilot] Step 2: Budget check...");
    const dashStatsPromise = db.getDashboardStats();
    const dashStatsTimeout = new Promise<null>((_, reject) => setTimeout(() => reject(new Error("getDashboardStats timed out after 30s")), 30000));
    let dashStats: Awaited<ReturnType<typeof db.getDashboardStats>>;
    try {
      dashStats = await Promise.race([dashStatsPromise, dashStatsTimeout]) as any;
    } catch (err: any) {
      log(`[Autopilot] ERROR: Budget check failed: ${err.message}`);
      stats.errors.push(`Budget check failed: ${err.message}`);
      stats.completedAt = new Date();
      await logCycle(stats);
      return stats;
    }
    const totalDeployed = dashStats?.totalCapitalDeployed || 0;
    const remainingCapital = maxTotalCapital - totalDeployed;
    const dailySpent = dashStats?.dailySpent || 0;
    const remainingDailyBudget = dailyBuyBudget - dailySpent;
    log(`[Autopilot] Budget: deployed=$${totalDeployed.toFixed(2)}/$${maxTotalCapital}, daily=$${dailySpent.toFixed(2)}/$${dailyBuyBudget}, remaining=$${remainingCapital.toFixed(2)}, dailyRemaining=$${remainingDailyBudget.toFixed(2)}`);

    // ===== DRAWDOWN PROTECTION =====
    const pnlPercent = dashStats?.totalPnlPercent || 0;
    const maxDrawdown = parseFloat(configMap.get("maxDrawdownPercent") || String(DEFAULT_RISK_CONFIG.maxDrawdownPercent));
    if (pnlPercent <= -maxDrawdown) {
      log(`🚨 HARD DRAWDOWN HIT (${pnlPercent.toFixed(1)}% <= -${maxDrawdown}%). Auto-pausing bot.`);
      await db.setConfig("killSwitch", "true", `Auto-paused due to ${pnlPercent.toFixed(1)}% drawdown`);
      await sendTelegramAlert(`🚨 BOT AUTO-PAUSED: ${pnlPercent.toFixed(1)}% drawdown hit on $${maxTotalCapital} capital`);
      stats.errors.push(`Hard drawdown hit: ${pnlPercent.toFixed(1)}%`);
      stats.completedAt = new Date();
      await logCycle(stats);
      return stats;
    }

    if (remainingCapital <= 0) {
      log(`[Autopilot] STOPPING: Capital limit reached: $${totalDeployed.toFixed(2)} / $${maxTotalCapital}`);
      stats.errors.push(`Capital limit reached: $${totalDeployed.toFixed(2)} / $${maxTotalCapital}`);
      stats.completedAt = new Date();
      await logCycle(stats);
      return stats;
    }
    if (remainingDailyBudget <= 0) {
      log(`[Autopilot] STOPPING: Daily budget exhausted: $${dailySpent.toFixed(2)} / $${dailyBuyBudget}`);
      stats.errors.push(`Daily budget exhausted: $${dailySpent.toFixed(2)} / $${dailyBuyBudget}`);
      stats.completedAt = new Date();
      await logCycle(stats);
      return stats;
    }

    // ===== STEP 3: Scan for cheap outcomes =====
    log(`[Autopilot] Step 3: Scanning ${scanPages} pages for cheap outcomes...`);
    const cheapOutcomes = await scanForCheapOutcomes(minPrice, maxPrice, minLiquidity, minHours, scanPages);
    stats.marketsScanned = scanPages * 100;
    stats.cheapFound = cheapOutcomes.length;

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

    // ===== STEP 4: AI filter (reject impossibles only) =====
    log("[Autopilot] Step 3: AI filtering (reject impossibles only)...");
    const unevaluated = await db.getUnevaluatedEvents(100);
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
      let rejected = 0;
      for (const event of unevaluated) {
        const key = event.marketId + "_0";
        const result = aiResults.get(key);
        if (result) {
          await db.updateScannedEventAi(event.id, result.score, result.reasoning);
          evaluated++;
          if (result.isImpossible) rejected++;
        }
      }
      stats.aiEvaluated = evaluated;
      stats.aiRejected = rejected;
    }

    // ===== STEP 5: Select events - DIVERSIFIED =====
    log("[Autopilot] Step 4: Selecting diversified events...");

    const approvedEvents = await db.getScannedEvents({
      status: "evaluated",
      minAiScore: minAiScore,
      limit: 500,
    });

    // Only check open positions for dedup (exclude sold/closed phantom positions)
    const existingPositions = await db.getPositions("open");
    const existingMarketIds = new Set(existingPositions.map(p => p.marketId));

    const buyable = approvedEvents.filter(e =>
      !existingMarketIds.has(e.marketId) &&
      e.tokenId &&
      parseFloat(e.aiScore || "0") >= minAiScore
    );

    // TIMEFRAME-AWARE MIXING: interleave short-dated and long-dated events
    // This ensures each cycle buys a mix of quick-resolving and longer bets
    const shuffled = mixByTimeframe(buyable);

    // Deduplicate by event group - checks EXISTING positions + within-batch
    const existingGroupCounts = await getExistingEventGroupCounts();
    const allowedMarketIds = filterByEventGroup(shuffled, existingGroupCounts);
    const deduplicated = shuffled.filter(e => allowedMarketIds.has(e.marketId));
    log(`[Autopilot] After event-group dedup: ${deduplicated.length} candidates (from ${buyable.length}, max ${MAX_POSITIONS_PER_EVENT_GROUP}/group)`);
    log(`[Autopilot] Existing event groups: ${existingGroupCounts.size} groups across ${existingPositions.length} positions`);
    stats.approved = deduplicated.length;

    // ===== STEP 6: Place orders with category-aware selection =====
    log(`[Autopilot] Step 5: Placing diversified orders...`);
    const categoryUsage = await getCategoryUsage();
    let currentDailySpent = dailySpent;
    let currentTotalDeployed = totalDeployed;

    const maxOrdersPerCycle = parseInt(configMap.get("autopilotMaxOrders") || "50");
    let ordersThisCycle = 0;
    const cycleCategories = new Map<string, number>();

    for (const event of deduplicated) {
      if (ordersThisCycle >= maxOrdersPerCycle) break;

      const currentRemainingDaily = dailyBuyBudget - currentDailySpent;
      const currentRemainingCapital = maxTotalCapital - currentTotalDeployed;
      if (currentRemainingDaily < flatBetSize || currentRemainingCapital < flatBetSize) break;

      const category = event.category || "other";
      if (!canBuyInCategory(category, flatBetSize, categoryUsage, currentTotalDeployed, maxCategoryPercent)) {
        log(`[Autopilot] Skipping ${category} - cap reached (${maxCategoryPercent}%)`);
        continue;
      }

      try {
        const ob = await analyzeOrderbook(event.tokenId!);
        if (!ob.fillableAtPrice || ob.bestAsk === null || ob.bestAsk > parseFloat(event.price) * 2) {
          continue;
        }

        const price = ob.bestAsk;
        const shares = flatBetSize / price;

        const orderId = await db.createOrder({
          scannedEventId: event.id,
          marketId: event.marketId,
          tokenId: event.tokenId!,
          side: "BUY",
          price: String(price),
          size: String(shares),
          amountUsd: String(flatBetSize),
          status: "pending",
        });

        const walletKey = configMap.get("walletPrivateKey") || process.env.POLYGON_PRIVATE_KEY;
        if (!walletKey) {
          await db.updateOrderStatus(orderId!, "pending", "Simulated - wallet not configured");
        } else {
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
              const orderStatus = result.matched ? "filled" : "placed";
              await db.updateOrderStatus(orderId!, orderStatus, undefined, result.orderId);
              await db.createScanLog({
                action: "clob_order",
                details: `[${category}] ${event.question.slice(0, 50)}... @ $${price.toFixed(4)} x ${shares.toFixed(1)} ($${flatBetSize}) orderId=${result.orderId || 'none'} status=${orderStatus}`,
              });
            } else {
              await db.updateOrderStatus(orderId!, "failed", `CLOB error: ${result.errorMsg}`);
              stats.errors.push(`CLOB fail [${category}]: ${result.errorMsg}`);
              continue;
            }
          } catch (clobErr: any) {
            await db.updateOrderStatus(orderId!, "failed", `CLOB exception: ${clobErr.message}`);
            stats.errors.push(`CLOB exception [${category}]: ${clobErr.message}`);
            continue;
          }
        }

        await db.createPosition({
          scannedEventId: event.id,
          marketId: event.marketId,
          tokenId: event.tokenId!,
          question: event.question,
          outcome: event.outcome,
          category: event.category,
          entryPrice: String(price),
          shares: String(shares),
          costBasis: String(flatBetSize),
          currentPrice: String(price),
          currentValue: String(flatBetSize),
          pnl: "0",
          pnlPercent: "0",
          endDate: event.endDate,
        });

        await db.updateScannedEventStatus(event.id, "ordered");

        currentDailySpent += flatBetSize;
        currentTotalDeployed += flatBetSize;
        ordersThisCycle++;
        stats.ordersPlaced++;
        stats.totalSpent += flatBetSize;

        const catUsage = categoryUsage.get(category) || { count: 0, totalCost: 0 };
        categoryUsage.set(category, {
          count: catUsage.count + 1,
          totalCost: catUsage.totalCost + flatBetSize,
        });
        cycleCategories.set(category, (cycleCategories.get(category) || 0) + 1);

        await new Promise(r => setTimeout(r, 300));
      } catch (err: any) {
        stats.errors.push(`Order error [${category}]: ${err.message}`);
        log(`[Autopilot] ERROR: Order error: ${err}`);
      }
    }

    stats.categoryBreakdown = Object.fromEntries(cycleCategories);
    stats.categoriesUsed = cycleCategories.size;

    // ===== STEP 7: Check fill status of existing orders =====
    log("[Autopilot] Step 6: Checking order fill status...");
    try {
      const placedOrderIds = await db.getPlacedOrderIds();
      if (placedOrderIds.length > 0) {
        const fillStats = await checkOrderFills(placedOrderIds);
        stats.fillsChecked = fillStats.checked;
        stats.fillsFilled = fillStats.filled;
        stats.fillsCancelled = fillStats.cancelled;
        stats.fillsOpen = fillStats.open;
        log(`[Autopilot] Fill check: ${fillStats.checked} checked, ${fillStats.filled} filled, ${fillStats.partial} partial, ${fillStats.cancelled} cancelled, ${fillStats.open} open`);
      }
    } catch (fillErr: any) {
      log(`[Autopilot] ERROR: Fill check error: ${fillErr.message}`);
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
  const catSummary = Object.entries(stats.categoryBreakdown)
    .map(([cat, count]) => `${cat}:${count}`)
    .join(", ");

  const details = [
    `Scanned: ${stats.cheapFound} cheap outcomes`,
    `New: ${stats.newDiscovered}`,
    `AI: ${stats.aiEvaluated} evaluated, ${stats.aiRejected} rejected`,
    `Orders: ${stats.ordersPlaced} ($${stats.totalSpent.toFixed(2)}) across ${stats.categoriesUsed} categories`,
    catSummary ? `Categories: ${catSummary}` : "",
    `Resolutions: ${stats.wins}W/${stats.losses}L`,
    stats.fillsChecked > 0 ? `Fills: ${stats.fillsFilled} filled, ${stats.fillsCancelled} cancelled, ${stats.fillsOpen} open (of ${stats.fillsChecked})` : "",
    stats.errors.length > 0 ? `Errors: ${stats.errors.slice(0, 3).join("; ")}` : "",
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

export async function startAutopilot(intervalHours = 2): Promise<void> {
  if (isRunning) {
    log("[Autopilot] Already running");
    return;
  }

  isRunning = true;
  log(`[Autopilot] Starting DIVERSIFIED strategy with ${intervalHours}h interval`);

  const runAndSchedule = async () => {
    if (!isRunning) return;

    lastRunAt = new Date();
    try {
      lastRunStats = await runCycle();
    } catch (err) {
      log(`[Autopilot] ERROR: Unhandled cycle error: ${err}`);
    }

    if (isRunning) {
      const intervalMs = intervalHours * 60 * 60 * 1000;
      nextRunAt = new Date(Date.now() + intervalMs);
      loopTimer = setTimeout(runAndSchedule, intervalMs);
    }
  };

  await sendTelegramAlert(`✅ Bot started on Frankfurt | Capital: $${DEFAULT_RISK_CONFIG.maxTotalCapital} | Daily budget: $${DEFAULT_RISK_CONFIG.dailyBuyBudget}`);
  await runAndSchedule();
}

export function stopAutopilot(): void {
  isRunning = false;
  if (loopTimer) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }
  nextRunAt = null;
  log("[Autopilot] Stopped");
}

export async function runSingleCycle(): Promise<AutopilotRunStats> {
  lastRunAt = new Date();
  lastRunStats = await runCycle();
  return lastRunStats;
}
