/**
 * Polymarket Gamma API Service
 * Handles all communication with the public Gamma API for market discovery.
 */

const GAMMA_BASE = "https://gamma-api.polymarket.com";
const CLOB_BASE = "https://clob.polymarket.com";

interface RawMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  outcomes: string;
  outcomePrices: string;
  liquidity: string;
  volume: string;
  volumeNum?: number;
  endDate: string;
  active: boolean;
  closed: boolean;
  clobTokenIds?: string;
  orderPriceMinTickSize: number;
  orderMinSize: number;
  negRisk: boolean;
  bestAsk?: number;
  bestBid?: number;
  description?: string;
  groupItemTitle?: string;
}

interface RawEvent {
  id: string;
  title: string;
  slug: string;
  tags?: Array<{ id: string; label: string; slug: string }>;
  markets: RawMarket[];
}

export interface ParsedCheapOutcome {
  marketId: string;
  conditionId: string;
  tokenId: string;
  question: string;
  outcome: string;
  outcomeIndex: number;
  price: number;
  liquidity: number;
  volume: number;
  endDate: string;
  slug: string;
  eventSlug: string;
  eventTitle: string;
  tags: Array<{ id: string; label: string; slug: string }>;
  category: string;
  tickSize: number;
  minOrderSize: number;
  negRisk: boolean;
  hoursToResolution: number;
  description?: string;
}

export interface OrderbookData {
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "PolymarketBot/1.0" },
      signal: controller.signal,
      // @ts-ignore - ensure we bypass any global proxy agent
      dispatcher: undefined,
    });
    if (!resp.ok) {
      throw new Error(`Gamma API error: ${resp.status} ${resp.statusText} for ${url}`);
    }
    return resp.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetch all active events with their markets, paginated */
export async function fetchActiveEvents(limit = 100, offset = 0): Promise<RawEvent[]> {
  const url = `${GAMMA_BASE}/events?active=true&closed=false&limit=${limit}&offset=${offset}`;
  return fetchJson<RawEvent[]>(url);
}

/** Fetch active markets directly */
export async function fetchActiveMarkets(limit = 100, offset = 0): Promise<RawMarket[]> {
  const url = `${GAMMA_BASE}/markets?active=true&closed=false&limit=${limit}&offset=${offset}`;
  return fetchJson<RawMarket[]>(url);
}

/** Fetch orderbook for a specific token */
export async function fetchOrderbook(tokenId: string): Promise<OrderbookData> {
  const url = `${CLOB_BASE}/book?token_id=${tokenId}`;
  return fetchJson<OrderbookData>(url);
}

/** Fetch all available tags */
export async function fetchTags(): Promise<Array<{ id: string; label: string; slug: string }>> {
  return fetchJson(`${GAMMA_BASE}/tags`);
}

/**
 * Look up a market by its conditionId or marketId to check resolution status.
 * Returns the market's resolved state and winning outcome.
 */
export async function lookupMarketResolution(marketId: string): Promise<{
  resolved: boolean;
  winningOutcome: string | null;
  closed: boolean;
  active: boolean;
  outcomePrices: number[];
} | null> {
  try {
    const url = `${GAMMA_BASE}/markets/${marketId}`;
    const market = await fetchJson<RawMarket>(url);
    const prices = parseJsonField<string[]>(market.outcomePrices, []);
    const numPrices = prices.map(p => parseFloat(p));
    
    // Determine winning outcome: if one price is 1.0 (or very close), that outcome won
    let winningOutcome: string | null = null;
    const outcomes = parseJsonField<string[]>(market.outcomes, []);
    for (let i = 0; i < numPrices.length; i++) {
      if (numPrices[i] >= 0.99) {
        winningOutcome = outcomes[i] || null;
      }
    }
    
    return {
      resolved: market.closed && !market.active,
      winningOutcome,
      closed: market.closed,
      active: market.active,
      outcomePrices: numPrices,
    };
  } catch (err) {
    // Market not found or API error
    return null;
  }
}

function parseJsonField<T>(field: string | undefined, fallback: T): T {
  if (!field) return fallback;
  try {
    return JSON.parse(field) as T;
  } catch {
    return fallback;
  }
}

function inferCategory(tags: Array<{ id: string; label: string; slug: string }>): string {
  const majorCategories = [
    "politics", "crypto", "sports", "finance", "tech", "science",
    "entertainment", "business", "economy", "nfl", "nba", "nhl",
    "mlb", "soccer", "mma", "boxing", "tennis", "golf",
    "pop-culture", "ai", "climate", "health",
  ];
  for (const tag of tags) {
    const slug = tag.slug.toLowerCase();
    for (const cat of majorCategories) {
      if (slug.includes(cat)) return cat;
    }
  }
  if (tags.length > 0) return tags[0].slug;
  return "other";
}

/**
 * Scan all active markets and find cheap outcomes.
 * This is the core scanner that paginates through the Gamma API.
 */
export async function scanForCheapOutcomes(
  minPrice: number,
  maxPrice: number,
  minLiquidity: number,
  minHoursToResolution: number,
  maxPages = 50,
): Promise<ParsedCheapOutcome[]> {
  const results: ParsedCheapOutcome[] = [];
  const seenMarketIds = new Set<string>();
  const now = Date.now();

  for (let page = 0; page < maxPages; page++) {
    let events: RawEvent[];
    try {
      events = await fetchActiveEvents(100, page * 100);
    } catch (err) {
      console.error(`[Scanner] Error fetching page ${page}:`, err);
      break;
    }

    if (!events || events.length === 0) break;

    for (const event of events) {
      const eventTags = event.tags || [];
      const category = inferCategory(eventTags);

      for (const market of event.markets || []) {
        if (seenMarketIds.has(market.id)) continue;
        seenMarketIds.add(market.id);

        if (!market.active || market.closed) continue;

        const outcomes = parseJsonField<string[]>(market.outcomes, []);
        const prices = parseJsonField<string[]>(market.outcomePrices, []);
        const tokenIds = parseJsonField<string[]>(market.clobTokenIds, []);
        const liquidity = parseFloat(market.liquidity || "0");
        const volume = market.volumeNum || parseFloat(market.volume || "0");

        if (liquidity < minLiquidity) continue;

        const endDate = market.endDate;
        if (!endDate) continue;
        const hoursToResolution = (new Date(endDate).getTime() - now) / (1000 * 60 * 60);
        if (hoursToResolution < minHoursToResolution) continue;

        for (let i = 0; i < prices.length; i++) {
          const price = parseFloat(prices[i]);
          if (price < minPrice || price > maxPrice) continue;
          if (i >= tokenIds.length) continue;

          results.push({
            marketId: market.id,
            conditionId: market.conditionId,
            tokenId: tokenIds[i],
            question: market.question,
            outcome: outcomes[i] || `Outcome ${i}`,
            outcomeIndex: i,
            price,
            liquidity,
            volume,
            endDate,
            slug: market.slug,
            eventSlug: event.slug,
            eventTitle: event.title,
            tags: eventTags,
            category,
            tickSize: market.orderPriceMinTickSize || 0.01,
            minOrderSize: market.orderMinSize || 5,
            negRisk: market.negRisk || false,
            hoursToResolution: Math.round(hoursToResolution),
            description: market.description,
          });
        }
      }
    }

    // Progress logging every 10 pages
    if ((page + 1) % 10 === 0 || page === 0) {
      console.log(`[Scanner] Page ${page + 1}/${maxPages}: ${results.length} cheap outcomes found so far`);
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 200));
  }

  // Sort by liquidity descending, then by price ascending
  results.sort((a, b) => {
    if (b.liquidity !== a.liquidity) return b.liquidity - a.liquidity;
    return a.price - b.price;
  });

  return results;
}

/**
 * Get orderbook analysis for a specific token.
 * Returns spread, depth, and whether it's safe to buy.
 */
export async function analyzeOrderbook(tokenId: string): Promise<{
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  bidDepth: number;
  askDepth: number;
  fillableAtPrice: boolean;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
  apiError?: boolean;
}> {
  try {
    const book = await fetchOrderbook(tokenId);
    const bids = book.bids || [];
    const asks = book.asks || [];

    const bestBid = bids.length > 0 ? Math.max(...bids.map(b => parseFloat(b.price))) : null;
    const bestAsk = asks.length > 0 ? Math.min(...asks.map(a => parseFloat(a.price))) : null;
    const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
    const bidDepth = bids.reduce((sum, b) => sum + parseFloat(b.size), 0);
    const askDepth = asks.reduce((sum, a) => sum + parseFloat(a.size), 0);

    return {
      bestBid,
      bestAsk,
      spread,
      bidDepth,
      askDepth,
      fillableAtPrice: bestAsk !== null && askDepth > 0,
      bids: bids.slice(0, 10),
      asks: asks.slice(0, 10),
      apiError: false,
    };
  } catch (err) {
    console.error(`[Orderbook] Error analyzing ${tokenId}:`, err);
    return {
      bestBid: null,
      bestAsk: null,
      spread: null,
      bidDepth: 0,
      askDepth: 0,
      fillableAtPrice: false,
      bids: [],
      asks: [],
      apiError: true, // Flag that this was an API error, not a genuinely empty orderbook
    };
  }
}
