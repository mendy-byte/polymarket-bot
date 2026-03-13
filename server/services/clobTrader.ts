/**
 * CLOB Trading Service
 * Handles live order placement on Polymarket's CLOB (Central Limit Order Book).
 * 
 * Flow:
 * 1. Initialize ClobClient with wallet private key
 * 2. Derive API credentials (createOrDeriveApiKey) - one time, then cached
 * 3. Place GTC limit orders via createAndPostOrder
 * 4. Maintain heartbeat to keep orders alive
 * 5. Check balances and allowances
 */

import { ClobClient, Side, OrderType, SignatureType } from "@polymarket/clob-client";
import type { TickSize as ClobTickSize, CreateOrderOptions } from "@polymarket/clob-client";
import { Wallet } from "ethers";
import * as db from "../db";
import { initializeProxy, getProxyStatus } from "./proxySetup";

const CLOB_HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137; // Polygon mainnet

// Singleton client instance
let clobClient: ClobClient | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatId = "";
let isInitialized = false;
let initError: string | null = null;

export interface ClobCredentials {
  apiKey: string;
  secret: string;
  passphrase: string;
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  errorMsg?: string;
  transactionsHashes?: string[];
}

/**
 * Initialize the CLOB client with wallet credentials.
 * Derives API credentials if not already cached.
 */
export async function initializeClobClient(): Promise<{ success: boolean; error?: string }> {
  try {
    // Initialize SOCKS5 proxy for CLOB requests (routes through Amsterdam)
    const proxyStatus = getProxyStatus();
    if (!proxyStatus.active) {
      console.log("[CLOB] Initializing SOCKS5 proxy for CLOB API access...");
      initializeProxy();
    }

    const configRows = await db.getAllConfig();
    const configMap = new Map(configRows.map(c => [c.key, c.value]));

    const privateKey = configMap.get("walletPrivateKey") || process.env.POLYGON_PRIVATE_KEY;
    const walletAddress = configMap.get("walletAddress") || process.env.POLYGON_WALLET_ADDRESS;

    if (!privateKey) {
      initError = "No wallet private key configured";
      return { success: false, error: initError };
    }

    // Ensure private key has 0x prefix
    const formattedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;

    // Create ethers wallet
    const signer = new Wallet(formattedKey);
    const derivedAddress = signer.address;

    // Save address if not already saved
    if (!walletAddress || walletAddress !== derivedAddress) {
      await db.setConfig("walletAddress", derivedAddress, "Derived from private key");
    }

    // Check for cached CLOB credentials
    let apiKey = configMap.get("clobApiKey");
    let apiSecret = configMap.get("clobApiSecret");
    let passphrase = configMap.get("clobPassphrase");

    if (!apiKey || !apiSecret || !passphrase) {
      // Derive credentials from wallet using deriveApiKey (deterministic, works for new wallets)
      console.log("[CLOB] Deriving API credentials from wallet...");
      const tempClient = new ClobClient(CLOB_HOST, CHAIN_ID, signer, undefined, SignatureType.EOA);
      const creds = await tempClient.deriveApiKey();

      // deriveApiKey returns { key, secret, passphrase }
      apiKey = creds.key || (creds as any).apiKey;
      apiSecret = creds.secret;
      passphrase = creds.passphrase;

      if (!apiKey) {
        throw new Error("Failed to derive API key - got empty key from deriveApiKey()");
      }

      // Cache in database
      await db.setConfig("clobApiKey", apiKey, "CLOB API key (derived)");
      await db.setConfig("clobApiSecret", apiSecret, "CLOB API secret (derived)");
      await db.setConfig("clobPassphrase", passphrase, "CLOB API passphrase (derived)");

      console.log("[CLOB] API credentials derived and cached successfully");
      await db.createScanLog({
        action: "clob_init",
        details: `CLOB API credentials derived for wallet ${derivedAddress.slice(0, 8)}...${derivedAddress.slice(-6)}`,
      });
    }

    // Initialize the full trading client
    clobClient = new ClobClient(
      CLOB_HOST,
      CHAIN_ID,
      signer,
      { key: apiKey, secret: apiSecret, passphrase },
      SignatureType.EOA,       // EOA wallet type
      derivedAddress,          // funder address
    );

    // Verify connection
    const ok = await clobClient.getOk();
    if (ok !== "OK") {
      throw new Error(`CLOB server health check failed: ${ok}`);
    }

    isInitialized = true;
    initError = null;

    // Start heartbeat
    startHeartbeat();

    console.log("[CLOB] Client initialized successfully");
    return { success: true };

  } catch (err: any) {
    isInitialized = false;
    initError = err.message;
    console.error("[CLOB] Initialization failed:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Get the initialized CLOB client, or try to initialize it.
 */
async function getClient(): Promise<ClobClient> {
  if (!clobClient || !isInitialized) {
    const result = await initializeClobClient();
    if (!result.success || !clobClient) {
      throw new Error(`CLOB client not available: ${result.error || "Unknown error"}`);
    }
  }
  return clobClient;
}

/**
 * Maintain heartbeat to keep orders alive.
 * Polymarket requires a heartbeat every 10 seconds or orders get cancelled.
 * We send every 5 seconds to be safe.
 */
function startHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }

  heartbeatTimer = setInterval(async () => {
    if (!clobClient || !isInitialized) return;

    try {
      const resp = await clobClient.postHeartbeat(heartbeatId);
      heartbeatId = resp.heartbeat_id || "";
    } catch (_err: any) {
      // Heartbeat failures are non-fatal - silently ignore
      // The CLOB client dumps massive circular JSON on heartbeat errors
    }
  }, 5000);
}

/**
 * Stop the heartbeat timer.
 */
export function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  heartbeatId = "";
}

/**
 * Normalize tick size to match CLOB client's ROUNDING_CONFIG keys.
 * The CLOB client only accepts: "0.1", "0.01", "0.001", "0.0001"
 * But the Gamma API returns values like "0.0010" which don't match.
 */
function normalizeTickSize(tickSize: string): ClobTickSize {
  const val = parseFloat(tickSize);
  if (val >= 0.1) return "0.1";
  if (val >= 0.01) return "0.01";
  if (val >= 0.001) return "0.001";
  return "0.0001";
}

/**
 * Round a price to the nearest valid tick.
 */
function roundToTick(price: number, tickSize: string): number {
  const tick = parseFloat(tickSize);
  // Price must be >= tickSize and <= 1 - tickSize
  const minPrice = tick;
  const maxPrice = 1 - tick;
  // Round to tick precision
  const rounded = Math.round(price / tick) * tick;
  // Clamp to valid range
  return Math.max(minPrice, Math.min(maxPrice, parseFloat(rounded.toFixed(4))));
}

/**
 * Place a single GTC limit buy order on the CLOB.
 */
export async function placeLimitOrder(
  tokenId: string,
  price: number,
  size: number,
  tickSize: ClobTickSize = "0.01",
  negRisk: boolean = false,
): Promise<OrderResult> {
  try {
    const client = await getClient();

    // Validate and round price to valid tick
    const validPrice = roundToTick(price, tickSize);
    const tick = parseFloat(tickSize);
    
    // Recalculate size based on adjusted price to stay within budget
    const budget = price * size; // original budget
    const adjustedSize = Math.floor(budget / validPrice);
    
    if (adjustedSize < 1) {
      return { success: false, errorMsg: `Adjusted size < 1 after price rounding (price: ${validPrice}, tick: ${tickSize})` };
    }

    // Normalize tick size to match CLOB client's expected format
    const normalizedTick = normalizeTickSize(tickSize);
    console.log(`[CLOB] Placing order: token=${tokenId.slice(0,10)}... price=${validPrice} size=${adjustedSize} tick=${normalizedTick} negRisk=${negRisk}`);

    const response = await client.createAndPostOrder(
      {
        tokenID: tokenId,
        price: validPrice,
        size: adjustedSize,
        side: Side.BUY,
      },
      {
        tickSize: normalizedTick,
        negRisk,
      } as Partial<CreateOrderOptions>,
      OrderType.GTC,
    );

    if (response && response.orderID) {
      return {
        success: true,
        orderId: response.orderID,
        transactionsHashes: response.transactionsHashes,
      };
    }

    // Check if the response indicates an error
    if (response && (response as any).errorMsg) {
      return {
        success: false,
        errorMsg: (response as any).errorMsg,
      };
    }

    return {
      success: true,
      orderId: response?.orderID || "unknown",
    };

  } catch (err: any) {
    console.error("[CLOB] Order placement failed:", err.message);
    return {
      success: false,
      errorMsg: err.message,
    };
  }
}

/**
 * Place multiple orders in batch (up to 15 per batch per CLOB API limits).
 */
export async function placeBatchOrders(
  orders: Array<{
    tokenId: string;
    price: number;
    size: number;
    tickSize: ClobTickSize;
    negRisk: boolean;
  }>,
): Promise<OrderResult[]> {
  const client = await getClient();
  const results: OrderResult[] = [];

  // Process in batches of 15 (CLOB API limit)
  const BATCH_SIZE = 15;
  for (let i = 0; i < orders.length; i += BATCH_SIZE) {
    const batch = orders.slice(i, i + BATCH_SIZE);

    try {
      // Build order objects
      const orderPromises = batch.map(async (o) => {
        try {
          const normalizedTick = normalizeTickSize(o.tickSize);
          const order = await client.createOrder(
            {
              tokenID: o.tokenId,
              price: o.price,
              size: o.size,
              side: Side.BUY,
            },
            {
              tickSize: normalizedTick,
              negRisk: o.negRisk,
            } as Partial<CreateOrderOptions>,
          );
          return order;
        } catch (err: any) {
          console.error(`[CLOB] Failed to create order for ${o.tokenId}:`, err.message);
          return null;
        }
      });

      const createdOrders = (await Promise.all(orderPromises)).filter(Boolean);

      if (createdOrders.length > 0) {
        const response = await client.postOrders(
            createdOrders.map(o => ({
              order: o as any,
              orderType: OrderType.GTC,
            }))
          );

        // Map results back
        for (let j = 0; j < batch.length; j++) {
          if (j < createdOrders.length && response) {
            results.push({
              success: true,
              orderId: (response as any)?.orderIDs?.[j] || `batch-${i + j}`,
            });
          } else {
            results.push({
              success: false,
              errorMsg: "Order creation failed in batch",
            });
          }
        }
      } else {
        // All orders in batch failed to create
        batch.forEach(() => {
          results.push({ success: false, errorMsg: "Failed to create order" });
        });
      }

    } catch (err: any) {
      // Entire batch failed
      console.error(`[CLOB] Batch order failed:`, err.message);
      batch.forEach(() => {
        results.push({ success: false, errorMsg: err.message });
      });
    }

    // Rate limit between batches
    if (i + BATCH_SIZE < orders.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return results;
}

/**
 * Cancel a specific order.
 */
export async function cancelOrder(orderId: string): Promise<boolean> {
  try {
    const client = await getClient();
    await client.cancelOrder({ orderID: orderId });
    return true;
  } catch (err: any) {
    console.error("[CLOB] Cancel order failed:", err.message);
    return false;
  }
}

/**
 * Cancel all open orders.
 */
export async function cancelAllOrders(): Promise<boolean> {
  try {
    const client = await getClient();
    await client.cancelAll();
    return true;
  } catch (err: any) {
    console.error("[CLOB] Cancel all orders failed:", err.message);
    return false;
  }
}

/**
 * Get open orders from the CLOB.
 */
export async function getOpenOrders(): Promise<any[]> {
  try {
    const client = await getClient();
    const orders = await client.getOpenOrders();
    return orders || [];
  } catch (err: any) {
    console.error("[CLOB] Get open orders failed:", err.message);
    return [];
  }
}

/**
 * Check USDC.e balance and allowance.
 */
export async function getBalanceAndAllowance(tokenId: string): Promise<{ balance: string; allowance: string } | null> {
  try {
    const client = await getClient();
    const result = await client.getBalanceAllowance({ asset_type: "COLLATERAL" as any });
    return result || null;
  } catch (err: any) {
    console.error("[CLOB] Balance check failed:", err.message);
    return null;
  }
}

/**
 * Get the CLOB client status.
 */
export function getClobStatus(): {
  initialized: boolean;
  error: string | null;
  heartbeatActive: boolean;
} {
  return {
    initialized: isInitialized,
    error: initError,
    heartbeatActive: !!heartbeatTimer,
  };
}

/**
 * Shutdown the CLOB client cleanly.
 */
export function shutdownClob() {
  stopHeartbeat();
  clobClient = null;
  isInitialized = false;
  initError = null;
  console.log("[CLOB] Client shutdown");
}
