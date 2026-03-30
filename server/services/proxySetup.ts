/**
 * SOCKS5 Proxy Setup for Polymarket CLOB API
 * 
 * The CLOB API geo-blocks trading from restricted regions.
 * Read-only endpoints (health, time, markets, orderbooks) work without proxy,
 * but ORDER PLACEMENT requires routing through a non-restricted region.
 * 
 * When SOCKS5_PROXY_URL is set, ALL axios traffic (used by the CLOB client
 * internally) is routed through the proxy. Native fetch() calls (used by
 * gammaApi for read-only data) remain direct.
 * 
 * We also monkey-patch JSON.stringify to handle circular references
 * caused by the SocksProxyAgent being attached to axios config objects.
 */

import axios, { AxiosInstance } from "axios";
import { SocksProxyAgent } from "socks-proxy-agent";

const CLOB_HOST = "https://clob.polymarket.com";
let proxyAgent: SocksProxyAgent | null = null;
let isProxyActive = false;
let connectionMode: "direct" | "proxy" | "none" = "none";

// Dedicated axios instance for proxied CLOB requests
let proxiedAxios: AxiosInstance | null = null;

/**
 * Monkey-patch JSON.stringify to handle circular references.
 * Needed because the CLOB client's error handler tries to
 * serialize the full axios config which includes agents.
 */
function patchJsonStringify() {
  const originalStringify = JSON.stringify;
  JSON.stringify = function (value: any, replacer?: any, space?: any): string {
    const seen = new WeakSet();
    const circularReplacer = (key: string, val: any) => {
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "[Circular]";
        seen.add(val);
      }
      if (typeof replacer === "function") return replacer(key, val);
      return val;
    };
    return originalStringify(value, circularReplacer, space);
  } as typeof JSON.stringify;
}

// Always patch JSON.stringify on import
patchJsonStringify();

/**
 * Test if proxy connection to CLOB API works for trading.
 * Tests the /time endpoint through the proxy.
 */
async function testProxyConnection(socksUrl: string): Promise<boolean> {
  try {
    const agent = new SocksProxyAgent(socksUrl);
    const response = await axios.get(`${CLOB_HOST}/time`, {
      timeout: 10000,
      httpAgent: agent,
      httpsAgent: agent,
      proxy: false,
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Clear proxy state (use direct connection).
 * Only suitable for read-only operations — trading will be geo-blocked
 * unless the server is in an allowed region.
 */
export function disableProxy(): void {
  // Reset global axios defaults
  axios.defaults.httpAgent = undefined;
  axios.defaults.httpsAgent = undefined;
  axios.defaults.proxy = undefined;
  isProxyActive = false;
  connectionMode = "direct";
  proxyAgent = null;
  proxiedAxios = null;
}

/**
 * Enable SOCKS5 proxy — sets global axios defaults so the CLOB client
 * (which uses axios internally) routes all requests through the proxy.
 * Also creates a dedicated proxied axios instance for explicit use.
 */
function enableProxy(socksUrl: string): boolean {
  try {
    proxyAgent = new SocksProxyAgent(socksUrl);
    
    // Set global defaults so the CLOB client routes through proxy
    axios.defaults.httpAgent = proxyAgent;
    axios.defaults.httpsAgent = proxyAgent;
    axios.defaults.proxy = false;
    
    // Also create a dedicated instance for explicit use
    proxiedAxios = axios.create({
      httpAgent: proxyAgent,
      httpsAgent: proxyAgent,
      proxy: false,
    });
    
    isProxyActive = true;
    connectionMode = "proxy";
    console.log(`[Proxy] SOCKS5 proxy enabled: ${socksUrl.replace(/\/\/.*@/, '//***@')}`);
    return true;
  } catch (err: any) {
    console.error(`[Proxy] Failed to enable: ${err.message}`);
    return false;
  }
}

/**
 * Initialize connection with retry logic.
 * 
 * If SOCKS5_PROXY_URL is set: use proxy (required for geo-blocked regions).
 * If not set: use direct connection (only works in allowed regions).
 * 
 * Retry strategy: try proxy up to 3 times with increasing delays.
 * If proxy fails all retries, fall back to direct (scanning works, trading may not).
 */
export async function initializeConnection(): Promise<"proxy" | "direct" | "failed"> {
  const socksUrl = process.env.SOCKS5_PROXY_URL || null;
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [2000, 5000, 10000]; // 2s, 5s, 10s

  // No proxy configured — use direct connection
  if (!socksUrl) {
    console.log("[Connection] No SOCKS5_PROXY_URL configured — using direct connection");
    console.log("[Connection] ⚠️ Trading may be geo-blocked without a proxy. Set SOCKS5_PROXY_URL if orders fail.");
    try {
      const directResp = await axios.get(`${CLOB_HOST}/time`, { timeout: 10000, proxy: false });
      if (directResp.status === 200) {
        disableProxy();
        connectionMode = "direct";
        console.log("[Connection] Direct connection to CLOB API works");
        return "direct";
      }
    } catch {
      console.warn("[Connection] Direct connection to CLOB API failed");
    }
    disableProxy();
    connectionMode = "direct";
    return "direct";
  }

  // Proxy configured — try with retries
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    console.log(`[Connection] Testing SOCKS5 proxy (attempt ${attempt + 1}/${MAX_RETRIES})...`);
    const proxyWorks = await testProxyConnection(socksUrl);
    
    if (proxyWorks) {
      enableProxy(socksUrl);
      console.log("[Connection] ✅ Proxy connection established — trading enabled");
      return "proxy";
    }

    if (attempt < MAX_RETRIES - 1) {
      const delay = RETRY_DELAYS[attempt];
      console.log(`[Connection] Proxy attempt ${attempt + 1} failed, retrying in ${delay / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // Proxy failed all retries — fall back to direct (scanning still works)
  console.warn("[Connection] ⚠️ PROXY UNAVAILABLE after 3 attempts — falling back to direct connection");
  console.warn("[Connection] ⚠️ Trading will likely be GEO-BLOCKED. Fix SOCKS5_PROXY_URL to resume.");
  disableProxy();
  connectionMode = "direct";
  return "direct";
}

/**
 * Initialize the proxy (legacy API — now calls initializeConnection).
 */
export function initializeProxy(proxyUrl?: string): boolean {
  const socksUrl = proxyUrl || process.env.SOCKS5_PROXY_URL;
  if (!socksUrl) {
    console.warn("[Proxy] No proxy URL provided and SOCKS5_PROXY_URL not set");
    return false;
  }
  return enableProxy(socksUrl);
}

/**
 * Test the current connection by making a request.
 */
export async function testProxy(): Promise<{ success: boolean; ip?: string; error?: string; mode?: string }> {
  try {
    const response = await axios.get("https://ifconfig.me/ip", { timeout: 10000 });
    const ip = response.data.trim();
    console.log(`[Connection] Test successful — exit IP: ${ip}, mode: ${connectionMode}`);
    return { success: true, ip, mode: connectionMode };
  } catch (err: any) {
    return { success: false, error: err.message, mode: connectionMode };
  }
}

/**
 * Check if proxy is active (trading through proxy).
 */
export function canTrade(): boolean {
  return isProxyActive && connectionMode === "proxy";
}

/**
 * Get proxy/connection status.
 */
export function getProxyStatus(): { active: boolean; url: string; mode: string } {
  return {
    active: isProxyActive,
    url: process.env.SOCKS5_PROXY_URL ? process.env.SOCKS5_PROXY_URL.replace(/\/\/.*@/, '//***@') : "(none)",
    mode: connectionMode,
  };
}

/**
 * Get the proxied axios instance for explicit use.
 */
export function getProxiedAxios(): AxiosInstance | null {
  return proxiedAxios;
}
