import { eq, and, gte, sql, desc, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2";
import { InsertUser, users, scannedEvents, positions, orders, botConfig, scanLogs } from "../drizzle/schema";
import type { InsertScannedEvent, InsertPosition, InsertOrder } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: mysql.Pool | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _pool = mysql.createPool({
        uri: process.env.DATABASE_URL,
        connectTimeout: 10000,
        waitForConnections: true,
        connectionLimit: 5,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000,
      }) as any;
      _db = drizzle(_pool as any);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ===== User queries =====
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = 'admin'; updateSet.role = 'admin'; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot get user: database not available"); return undefined; }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ===== Scanned Events =====
export async function upsertScannedEvent(event: InsertScannedEvent) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(scannedEvents)
    .where(and(eq(scannedEvents.marketId, event.marketId), eq(scannedEvents.outcome, event.outcome)))
    .limit(1);

  if (existing.length > 0) {
    await db.update(scannedEvents)
      .set({ price: event.price, liquidity: event.liquidity, volume: event.volume, bestBid: event.bestBid, bestAsk: event.bestAsk, spread: event.spread, hoursToResolution: event.hoursToResolution })
      .where(eq(scannedEvents.id, existing[0].id));
    return existing[0].id;
  } else {
    const result = await db.insert(scannedEvents).values(event);
    return result[0].insertId;
  }
}

export async function getScannedEvents(filters?: { status?: string; minAiScore?: number; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.status) conditions.push(eq(scannedEvents.status, filters.status as any));
  if (filters?.minAiScore) conditions.push(gte(scannedEvents.aiScore, String(filters.minAiScore)));

  const query = db.select().from(scannedEvents);
  if (conditions.length > 0) {
    return query.where(and(...conditions)).orderBy(desc(scannedEvents.updatedAt)).limit(filters?.limit || 100).offset(filters?.offset || 0);
  }
  return query.orderBy(desc(scannedEvents.updatedAt)).limit(filters?.limit || 100).offset(filters?.offset || 0);
}

export async function updateScannedEventAi(id: number, score: number, reasoning: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(scannedEvents).set({
    aiScore: String(score),
    aiReasoning: reasoning,
    aiEvaluatedAt: new Date(),
    status: score >= 3 ? "evaluated" : "rejected",
  }).where(eq(scannedEvents.id, id));
}

export async function updateScannedEventStatus(id: number, status: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(scannedEvents).set({ status: status as any }).where(eq(scannedEvents.id, id));
}

export async function getUnevaluatedEvents(limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(scannedEvents).where(eq(scannedEvents.status, "discovered")).orderBy(desc(scannedEvents.liquidity)).limit(limit);
}

// ===== Event Group Helpers =====
/**
 * Get event slugs for a set of scannedEventIds.
 * Used to check how many positions we already hold in each event group.
 */
export async function getEventSlugsForPositions(scannedEventIds: number[]): Promise<Map<number, string>> {
  const db = await getDb();
  if (!db || scannedEventIds.length === 0) return new Map();
  const rows = await db.select({ id: scannedEvents.id, eventSlug: scannedEvents.eventSlug, marketId: scannedEvents.marketId })
    .from(scannedEvents)
    .where(inArray(scannedEvents.id, scannedEventIds));
  const result = new Map<number, string>();
  for (const r of rows) {
    result.set(r.id, r.eventSlug || r.marketId);
  }
  return result;
}

// ===== Positions =====
export async function createPosition(pos: InsertPosition) {
  const db = await getDb();
  if (!db) return;
  const result = await db.insert(positions).values(pos);
  return result[0].insertId;
}

export async function getPositions(status?: string) {
  const db = await getDb();
  if (!db) return [];
  if (status) {
    return db.select().from(positions).where(eq(positions.status, status as any)).orderBy(desc(positions.createdAt));
  }
  return db.select().from(positions).orderBy(desc(positions.createdAt));
}

export async function updatePositionPrice(id: number, currentPrice: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(positions).set({
    currentPrice: String(currentPrice),
    currentValue: sql`${String(currentPrice)} * shares`,
    pnl: sql`(${String(currentPrice)} * shares) - costBasis`,
    pnlPercent: sql`CASE WHEN costBasis > 0 THEN ((${String(currentPrice)} * shares - costBasis) / costBasis) * 100 ELSE 0 END`,
  }).where(eq(positions.id, id));
}

export async function resolvePosition(id: number, won: boolean) {
  const db = await getDb();
  if (!db) return;
  const pos = await db.select().from(positions).where(eq(positions.id, id)).limit(1);
  if (!pos[0]) return;
  const payout = won ? parseFloat(pos[0].shares) : 0;
  const pnl = payout - parseFloat(pos[0].costBasis);
  await db.update(positions).set({
    status: won ? "resolved_win" : "resolved_loss",
    resolvedAt: new Date(),
    resolutionPayout: String(payout),
    currentPrice: won ? "1" : "0",
    currentValue: String(payout),
    pnl: String(pnl),
    pnlPercent: String(parseFloat(pos[0].costBasis) > 0 ? (pnl / parseFloat(pos[0].costBasis)) * 100 : 0),
  }).where(eq(positions.id, id));
}

// ===== Orders =====
export async function createOrder(order: InsertOrder) {
  const db = await getDb();
  if (!db) return;
  const result = await db.insert(orders).values(order);
  return result[0].insertId;
}

export async function getOrders(status?: string) {
  const db = await getDb();
  if (!db) return [];
  if (status) {
    return db.select().from(orders).where(eq(orders.status, status as any)).orderBy(desc(orders.createdAt));
  }
  return db.select().from(orders).orderBy(desc(orders.createdAt));
}

export async function updateOrderStatus(id: number, status: string, errorMessage?: string) {
  const db = await getDb();
  if (!db) return;
  const update: Record<string, any> = { status: status as any };
  if (errorMessage) update.errorMessage = errorMessage;
  if (status === "filled") update.filledAt = new Date();
  await db.update(orders).set(update).where(eq(orders.id, id));
}

export async function updateOrderStatusByOrderId(orderId: string, status: string, filledAt?: Date) {
  const db = await getDb();
  if (!db) return;
  const update: Record<string, any> = { status: status as any };
  if (filledAt) update.filledAt = filledAt;
  await db.update(orders).set(update).where(eq(orders.orderId, orderId));
}

export async function getPlacedOrderIds(): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const result = await db.select({ orderId: orders.orderId })
    .from(orders)
    .where(inArray(orders.status, ["placed", "pending", "partial"] as any));
  return result.map(r => r.orderId).filter((id): id is string => !!id);
}

export async function getOrderFillStats(): Promise<{ total: number; filled: number; partial: number; cancelled: number; pending: number; placed: number; failed: number }> {
  const db = await getDb();
  if (!db) return { total: 0, filled: 0, partial: 0, cancelled: 0, pending: 0, placed: 0, failed: 0 };
  const allOrders = await db.select({ status: orders.status }).from(orders);
  const stats = { total: allOrders.length, filled: 0, partial: 0, cancelled: 0, pending: 0, placed: 0, failed: 0 };
  for (const o of allOrders) {
    if (o.status === "filled") stats.filled++;
    else if (o.status === "partial") stats.partial++;
    else if (o.status === "cancelled") stats.cancelled++;
    else if (o.status === "pending") stats.pending++;
    else if (o.status === "placed") stats.placed++;
    else if (o.status === "failed") stats.failed++;
  }
  return stats;
}

// ===== Bot Config =====
export async function getConfig(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(botConfig).where(eq(botConfig.key, key)).limit(1);
  return result[0]?.value ?? null;
}

export async function setConfig(key: string, value: string, description?: string) {
  const db = await getDb();
  if (!db) return;
  await db.insert(botConfig).values({ key, value, description })
    .onDuplicateKeyUpdate({ set: { value, description } });
}

export async function getAllConfig() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(botConfig);
}

// ===== Scan Logs =====
export async function createScanLog(log: { action: string; details?: string; marketsScanned?: number; cheapFound?: number; newDiscovered?: number; ordersPlaced?: number; errors?: number; duration?: number }) {
  const db = await getDb();
  if (!db) return;
  await db.insert(scanLogs).values(log);
}

export async function getRecentLogs(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(scanLogs).orderBy(desc(scanLogs.createdAt)).limit(limit);
}

// ===== Dashboard Stats =====
export async function getDashboardStats() {
  const db = await getDb();
  if (!db) return null;

  const allPositions = await db.select().from(positions);
  const openPos = allPositions.filter(p => p.status === "open");
  const wins = allPositions.filter(p => p.status === "resolved_win");
  const losses = allPositions.filter(p => p.status === "resolved_loss");

  const totalCost = allPositions.reduce((s, p) => s + parseFloat(p.costBasis), 0);
  const totalPnl = allPositions.reduce((s, p) => s + parseFloat(p.pnl || "0"), 0);
  const unrealizedPnl = openPos.reduce((s, p) => s + parseFloat(p.pnl || "0"), 0);

  const winPayouts = wins.map(w => parseFloat(w.pnl || "0"));
  const lossPayouts = losses.map(l => parseFloat(l.pnl || "0"));

  // Category breakdown
  const categoryMap = new Map<string, number>();
  for (const p of openPos) {
    const cat = p.category || "other";
    categoryMap.set(cat, (categoryMap.get(cat) || 0) + parseFloat(p.costBasis));
  }

  // Today's spending
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayOrders = await db.select().from(orders).where(gte(orders.createdAt, today));
  const dailySpent = todayOrders.reduce((s, o) => s + parseFloat(o.amountUsd), 0);

  const resolved = wins.length + losses.length;
  const winRate = resolved > 0 ? (wins.length / resolved) * 100 : 0;

  return {
    totalCapitalDeployed: totalCost,
    totalPositions: allPositions.length,
    openPositions: openPos.length,
    resolvedWins: wins.length,
    resolvedLosses: losses.length,
    totalPnl,
    totalPnlPercent: totalCost > 0 ? (totalPnl / totalCost) * 100 : 0,
    unrealizedPnl,
    bestWin: winPayouts.length > 0 ? Math.max(...winPayouts) : 0,
    worstLoss: lossPayouts.length > 0 ? Math.min(...lossPayouts) : 0,
    winRate,
    expectedValue: 0, // Calculated on frontend
    categoriesUsed: categoryMap.size,
    dailySpent,
    remainingBudget: 0, // Filled from config
    categoryBreakdown: Array.from(categoryMap.entries()).map(([cat, cost]) => ({
      category: cat,
      totalCost: cost,
      percentage: totalCost > 0 ? (cost / totalCost) * 100 : 0,
    })),
  };
}
