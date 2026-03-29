/**
 * On-chain position verifier.
 * Checks CTF (Conditional Token Framework) balances on Polygon to verify
 * that positions in the DB actually exist on-chain.
 * 
 * The CTF contract is an ERC-1155 where each tokenId represents a position outcome.
 * We call balanceOf(wallet, tokenId) for each position to confirm we hold shares.
 */

import { ethers } from "ethers";
import * as db from "../db";

// CTF contract on Polygon mainnet
const CTF_ADDRESS = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
const CTF_ABI = [
  "function balanceOf(address account, uint256 id) view returns (uint256)"
];

// Multiple RPCs for reliability
const RPC_URLS = [
  "https://1rpc.io/matic",
  "https://polygon-bor-rpc.publicnode.com",
  "https://rpc.ankr.com/polygon",
  "https://polygon.llamarpc.com",
];

const WALLET = process.env.POLYGON_WALLET_ADDRESS || "0xdE76851773CAC610873D87A8a801CE67a35B215d";

let provider: ethers.providers.JsonRpcProvider | null = null;
let ctfContract: ethers.Contract | null = null;

async function getProvider(): Promise<ethers.providers.JsonRpcProvider> {
  if (provider) {
    try {
      await provider.getBlockNumber();
      return provider;
    } catch {
      provider = null;
      ctfContract = null;
    }
  }

  for (const rpc of RPC_URLS) {
    try {
      const p = new ethers.providers.JsonRpcProvider(rpc);
      await p.getBlockNumber();
      provider = p;
      ctfContract = new ethers.Contract(CTF_ADDRESS, CTF_ABI, p);
      console.log(`[Verifier] Connected to RPC: ${rpc}`);
      return p;
    } catch {
      // Try next
    }
  }
  throw new Error("[Verifier] All Polygon RPCs failed");
}

function getContract(): ethers.Contract {
  if (!ctfContract) throw new Error("[Verifier] Not connected");
  return ctfContract;
}

/**
 * Check on-chain balance for a single position.
 * Returns the number of shares held on-chain (in human-readable units).
 */
export async function checkOnChainBalance(tokenId: string): Promise<number> {
  await getProvider();
  const ctf = getContract();
  const balance = await ctf.balanceOf(WALLET, tokenId);
  // CTF outcome tokens use 6 decimals (same as USDC)
  return parseFloat(ethers.utils.formatUnits(balance, 6));
}

/**
 * Verify a single position on-chain and update the DB.
 * Returns true if the position is real (has on-chain balance > 0).
 */
export async function verifyPosition(positionId: number, tokenId: string): Promise<boolean> {
  try {
    const balance = await checkOnChainBalance(tokenId);
    const isReal = balance > 0.001; // Threshold for dust

    await db.updatePositionVerification(positionId, isReal, balance);

    return isReal;
  } catch (err: any) {
    console.error(`[Verifier] Failed to verify position ${positionId}:`, err.message);
    return false; // Don't mark as verified on error
  }
}

/**
 * Verify all unverified open positions.
 * Called during each autopilot cycle.
 * Returns summary stats.
 */
export async function verifyAllOpenPositions(): Promise<{
  checked: number;
  verified: number;
  phantom: number;
  errors: number;
}> {
  const stats = { checked: 0, verified: 0, phantom: 0, errors: 0 };

  try {
    await getProvider();
  } catch (err: any) {
    console.error("[Verifier] Cannot connect to Polygon RPC:", err.message);
    return stats;
  }

  // Get all open positions that haven't been verified yet
  const openPositions = await db.getUnverifiedPositions();
  console.log(`[Verifier] Checking ${openPositions.length} unverified positions on-chain...`);

  for (const pos of openPositions) {
    try {
      const balance = await checkOnChainBalance(pos.tokenId);
      const isReal = balance > 0.001;
      stats.checked++;

      if (isReal) {
        stats.verified++;
        await db.updatePositionVerification(pos.id, true, balance);
      } else {
        stats.phantom++;
        // Mark as phantom (sold) — this position doesn't exist on-chain
        await db.updatePositionVerification(pos.id, false, 0);
        // If position was supposedly "open" but has 0 on-chain balance,
        // mark it as sold so it doesn't count toward capital deployed
        await db.markPositionAsSold(pos.id);
        console.log(`[Verifier] PHANTOM position #${pos.id}: ${pos.question.substring(0, 50)} — 0 on-chain balance, marking as sold`);
      }

      // Rate limit: 150ms between RPC calls
      await new Promise(r => setTimeout(r, 150));
    } catch (err: any) {
      stats.errors++;
      console.error(`[Verifier] Error checking position #${pos.id}:`, err.message);
    }
  }

  console.log(`[Verifier] Results: ${stats.verified} verified, ${stats.phantom} phantom, ${stats.errors} errors out of ${stats.checked} checked`);
  return stats;
}

/**
 * Quick verification for a newly placed order.
 * Called right after an order is confirmed as "matched" on the CLOB.
 * Waits a few seconds for on-chain settlement, then checks balance.
 */
export async function verifyNewPosition(positionId: number, tokenId: string, retries = 3): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    // Wait for on-chain settlement (increases with each retry)
    await new Promise(r => setTimeout(r, (i + 1) * 5000));

    try {
      const balance = await checkOnChainBalance(tokenId);
      if (balance > 0.001) {
        await db.updatePositionVerification(positionId, true, balance);
        console.log(`[Verifier] Position #${positionId} VERIFIED on-chain: ${balance} shares`);
        return true;
      }
    } catch (err: any) {
      console.error(`[Verifier] Retry ${i + 1}/${retries} failed for position #${positionId}:`, err.message);
    }
  }

  console.warn(`[Verifier] Position #${positionId} NOT verified after ${retries} retries — may be phantom`);
  return false;
}
