/**
 * SOCKS5 Proxy Setup for Polymarket CLOB API
 * 
 * Polymarket geoblocks certain regions from trading via the CLOB API.
 * This module routes ALL axios requests through a SOCKS5 proxy running
 * on a DigitalOcean droplet in Amsterdam.
 * 
 * We also monkey-patch JSON.stringify to handle circular references
 * caused by the SocksProxyAgent being attached to axios config objects.
 * The CLOB client's error handler calls JSON.stringify(err.response.config)
 * which includes the agent, creating a circular reference.
 */

import axios from "axios";
import { SocksProxyAgent } from "socks-proxy-agent";

const CLOB_HOST = "clob.polymarket.com";
let proxyAgent: SocksProxyAgent | null = null;
let isProxyActive = false;

/**
 * Monkey-patch JSON.stringify to handle circular references.
 * This is needed because the CLOB client's error handler tries to
 * serialize the full axios config which includes the SOCKS agent.
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

/**
 * Initialize the SOCKS5 proxy for CLOB API requests.
 * Sets axios.defaults.httpAgent/httpsAgent so ALL requests go through the proxy.
 * Also patches JSON.stringify to handle circular references from the agent.
 */
export function initializeProxy(proxyUrl?: string): boolean {
  const socksUrl = proxyUrl || process.env.SOCKS5_PROXY_URL || "socks5://152.42.139.184:1080";

  try {
    // Patch JSON.stringify first to prevent circular reference errors
    patchJsonStringify();

    proxyAgent = new SocksProxyAgent(socksUrl);

    // Set axios defaults - the CLOB client uses the default axios instance
    axios.defaults.httpAgent = proxyAgent;
    axios.defaults.httpsAgent = proxyAgent;
    axios.defaults.proxy = false;

    isProxyActive = true;
    console.log(`[Proxy] SOCKS5 proxy initialized: ${socksUrl}`);
    console.log(`[Proxy] All axios requests will be routed through Amsterdam`);
    return true;
  } catch (err: any) {
    console.error(`[Proxy] Failed to initialize: ${err.message}`);
    isProxyActive = false;
    return false;
  }
}

/**
 * Test the proxy connection by making a request through it.
 */
export async function testProxy(): Promise<{ success: boolean; ip?: string; error?: string }> {
  if (!proxyAgent) {
    return { success: false, error: "Proxy not initialized" };
  }

  try {
    const response = await axios.get("https://ifconfig.me/ip", {
      timeout: 10000,
    });
    const ip = response.data.trim();
    console.log(`[Proxy] Test successful - exit IP: ${ip}`);
    return { success: true, ip };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Get proxy status.
 */
export function getProxyStatus(): { active: boolean; url: string } {
  return {
    active: isProxyActive,
    url: process.env.SOCKS5_PROXY_URL || "socks5://152.42.139.184:1080",
  };
}
