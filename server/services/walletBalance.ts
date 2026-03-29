import { ethers } from "ethers";

// USDC.e on Polygon
const USDC_E_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const USDC_E_ABI = ["function balanceOf(address) view returns (uint256)"];

// Multiple RPC endpoints for reliability
const RPC_ENDPOINTS = [
  "https://polygon-rpc.com",
  "https://rpc-mainnet.matic.quiknode.pro",
  "https://polygon-mainnet.public.blastapi.io",
  "https://1rpc.io/matic",
];

// Cache: balance + timestamp (refresh every 60s)
let cachedBalance: { balance: number; timestamp: number } | null = null;
const CACHE_TTL_MS = 60_000;

/**
 * Get the USDC.e balance for the bot's wallet on Polygon.
 * Returns balance in human-readable units (6 decimals).
 */
export async function getWalletBalance(): Promise<{
  balance: number;
  address: string;
  cached: boolean;
  error?: string;
}> {
  const walletAddress = process.env.POLYGON_WALLET_ADDRESS;
  if (!walletAddress) {
    return { balance: 0, address: "", cached: false, error: "No wallet address configured" };
  }

  // Return cached value if fresh
  if (cachedBalance && Date.now() - cachedBalance.timestamp < CACHE_TTL_MS) {
    return { balance: cachedBalance.balance, address: walletAddress, cached: true };
  }

  // Try each RPC endpoint until one works
  for (const rpc of RPC_ENDPOINTS) {
    try {
      const provider = new ethers.providers.JsonRpcProvider(rpc);
      const contract = new ethers.Contract(USDC_E_ADDRESS, USDC_E_ABI, provider);
      const rawBalance = await contract.balanceOf(walletAddress);
      const balance = parseFloat(ethers.utils.formatUnits(rawBalance, 6));

      // Cache the result
      cachedBalance = { balance, timestamp: Date.now() };
      return { balance, address: walletAddress, cached: false };
    } catch (err) {
      // Try next RPC
      continue;
    }
  }

  // All RPCs failed — return cached if available, else error
  if (cachedBalance) {
    return { balance: cachedBalance.balance, address: walletAddress, cached: true, error: "RPC failed, using stale cache" };
  }
  return { balance: 0, address: walletAddress, cached: false, error: "All RPC endpoints failed" };
}

/**
 * Calculate real P&L based on wallet balance vs starting capital.
 */
export function calculateRealPnl(currentBalance: number, startingCapital: number): {
  realPnl: number;
  realPnlPercent: number;
} {
  const realPnl = currentBalance - startingCapital;
  const realPnlPercent = startingCapital > 0 ? (realPnl / startingCapital) * 100 : 0;
  return { realPnl, realPnlPercent };
}
