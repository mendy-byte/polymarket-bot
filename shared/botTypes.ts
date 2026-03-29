/** Risk control configuration */
export interface RiskConfig {
  maxTotalCapital: number;
  maxPerEvent: number;
  maxCategoryPercent: number;
  dailyBuyBudget: number;
  minPrice: number;
  maxPrice: number;
  minLiquidity: number;
  minHoursToResolution: number;
  minAiScore: number;
  killSwitch: boolean;
  botEnabled: boolean;
  maxDrawdownPercent: number;
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxTotalCapital: 1200,
  maxPerEvent: 5,           // Flat $5 per event (planktonXD strategy)
  maxCategoryPercent: 15,   // Hard cap: max 15% in any single category
  dailyBuyBudget: 200,
  minPrice: 0.001,
  maxPrice: 0.03,
  minLiquidity: 1000,
  minHoursToResolution: 24,
  minAiScore: 3,            // Reject-only: 1-2 = impossible, 3+ = buy
  killSwitch: false,
  botEnabled: false,
  maxDrawdownPercent: 40,   // Hard drawdown stop
};

/** Dashboard stats */
export interface DashboardStats {
  totalCapitalDeployed: number;
  totalPositions: number;
  openPositions: number;
  resolvedWins: number;
  resolvedLosses: number;
  totalPnl: number;
  totalPnlPercent: number;
  unrealizedPnl: number;
  bestWin: number;
  worstLoss: number;
  winRate: number;
  expectedValue: number;
  categoriesUsed: number;
  dailySpent: number;
  remainingBudget: number;
}

/** Scanner result from Gamma API */
export interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  outcomes: string[];
  outcomePrices: string[];
  liquidity: string;
  volume: string;
  endDate: string;
  active: boolean;
  closed: boolean;
  clobTokenIds: string[];
  orderPriceMinTickSize: number;
  orderMinSize: number;
  negRisk: boolean;
  tags?: Array<{ id: string; label: string; slug: string }>;
  bestAsk?: number;
  bestBid?: number;
}

/** AI evaluation result */
export interface AiEvaluation {
  score: number;
  reasoning: string;
  scenarios: string[];
  recommendation: 'buy' | 'skip' | 'watch';
}

/** Orderbook snapshot */
export interface OrderbookSnapshot {
  tokenId: string;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  bidDepth: number;
  askDepth: number;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
}

/** Category allocation */
export interface CategoryAllocation {
  category: string;
  count: number;
  totalCost: number;
  percentage: number;
  limit: number;
}
