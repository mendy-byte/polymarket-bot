import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, boolean, json, bigint } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** Scanned events from Gamma API */
export const scannedEvents = mysqlTable("scanned_events", {
  id: int("id").autoincrement().primaryKey(),
  marketId: varchar("marketId", { length: 128 }).notNull(),
  conditionId: varchar("conditionId", { length: 128 }),
  tokenId: varchar("tokenId", { length: 256 }),
  question: text("question").notNull(),
  outcome: varchar("outcome", { length: 64 }).notNull(),
  slug: varchar("slug", { length: 512 }),
  eventSlug: varchar("eventSlug", { length: 512 }),
  category: varchar("category", { length: 128 }),
  tags: json("tags"),
  price: decimal("price", { precision: 10, scale: 6 }).notNull(),
  liquidity: decimal("liquidity", { precision: 18, scale: 2 }),
  volume: decimal("volume", { precision: 18, scale: 2 }),
  bestBid: decimal("bestBid", { precision: 10, scale: 6 }),
  bestAsk: decimal("bestAsk", { precision: 10, scale: 6 }),
  spread: decimal("spread", { precision: 10, scale: 6 }),
  endDate: timestamp("endDate"),
  hoursToResolution: int("hoursToResolution"),
  aiScore: decimal("aiScore", { precision: 5, scale: 2 }),
  aiReasoning: text("aiReasoning"),
  aiEvaluatedAt: timestamp("aiEvaluatedAt"),
  status: mysqlEnum("status", ["discovered", "evaluated", "approved", "rejected", "ordered", "filled", "resolved_win", "resolved_loss", "expired"]).default("discovered").notNull(),
  tickSize: decimal("tickSize", { precision: 10, scale: 4 }),
  minOrderSize: int("minOrderSize"),
  negRisk: boolean("negRisk").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ScannedEvent = typeof scannedEvents.$inferSelect;
export type InsertScannedEvent = typeof scannedEvents.$inferInsert;

/** Positions - active bets placed by the bot */
export const positions = mysqlTable("positions", {
  id: int("id").autoincrement().primaryKey(),
  scannedEventId: int("scannedEventId").notNull(),
  marketId: varchar("marketId", { length: 128 }).notNull(),
  tokenId: varchar("tokenId", { length: 256 }).notNull(),
  question: text("question").notNull(),
  outcome: varchar("outcome", { length: 64 }).notNull(),
  category: varchar("category", { length: 128 }),
  entryPrice: decimal("entryPrice", { precision: 10, scale: 6 }).notNull(),
  shares: decimal("shares", { precision: 18, scale: 6 }).notNull(),
  costBasis: decimal("costBasis", { precision: 18, scale: 6 }).notNull(),
  currentPrice: decimal("currentPrice", { precision: 10, scale: 6 }),
  currentValue: decimal("currentValue", { precision: 18, scale: 6 }),
  pnl: decimal("pnl", { precision: 18, scale: 6 }),
  pnlPercent: decimal("pnlPercent", { precision: 10, scale: 2 }),
  status: mysqlEnum("status", ["open", "resolved_win", "resolved_loss", "sold"]).default("open").notNull(),
  resolvedAt: timestamp("resolvedAt"),
  resolutionPayout: decimal("resolutionPayout", { precision: 18, scale: 6 }),
  endDate: timestamp("endDate"),
  verified: boolean("verified").default(false),
  onChainShares: decimal("onChainShares", { precision: 18, scale: 6 }),
  verifiedAt: timestamp("verifiedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Position = typeof positions.$inferSelect;
export type InsertPosition = typeof positions.$inferInsert;

/** Orders placed via CLOB API */
export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  scannedEventId: int("scannedEventId").notNull(),
  orderId: varchar("orderId", { length: 256 }),
  marketId: varchar("marketId", { length: 128 }).notNull(),
  tokenId: varchar("tokenId", { length: 256 }).notNull(),
  side: varchar("side", { length: 8 }).notNull(),
  price: decimal("price", { precision: 10, scale: 6 }).notNull(),
  size: decimal("size", { precision: 18, scale: 6 }).notNull(),
  amountUsd: decimal("amountUsd", { precision: 18, scale: 6 }).notNull(),
  status: mysqlEnum("status", ["pending", "placed", "filled", "partial", "cancelled", "failed"]).default("pending").notNull(),
  errorMessage: text("errorMessage"),
  filledAt: timestamp("filledAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

/** Bot configuration and risk parameters */
export const botConfig = mysqlTable("bot_config", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 128 }).notNull().unique(),
  value: text("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BotConfig = typeof botConfig.$inferSelect;

/** Scan and activity logs */
export const scanLogs = mysqlTable("scan_logs", {
  id: int("id").autoincrement().primaryKey(),
  action: varchar("action", { length: 64 }).notNull(),
  details: text("details"),
  marketsScanned: int("marketsScanned"),
  cheapFound: int("cheapFound"),
  newDiscovered: int("newDiscovered"),
  ordersPlaced: int("ordersPlaced"),
  errors: int("errors"),
  duration: int("duration"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ScanLog = typeof scanLogs.$inferSelect;
