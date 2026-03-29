/**
 * Check actual on-chain token balances for all "open" positions in the DB.
 * Uses the Polymarket CTF (Conditional Token Framework) contract on Polygon.
 * 
 * The CTF contract is an ERC-1155 where each tokenId represents a position.
 * We call balanceOf(wallet, tokenId) for each open position to see if we actually hold shares.
 */

import { ethers } from "ethers";
import mysql from "mysql2/promise";

// CTF contract on Polygon mainnet
const CTF_ADDRESS = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
const CTF_ABI = [
  "function balanceOf(address account, uint256 id) view returns (uint256)"
];

// Polygon RPC
// Try multiple RPCs for reliability
const RPC_URLS = [
  "https://rpc.ankr.com/polygon",
  "https://polygon.llamarpc.com",
  "https://1rpc.io/matic",
  "https://polygon-bor-rpc.publicnode.com",
];

const WALLET = "0xdE76851773CAC610873D87A8a801CE67a35B215d";

async function main() {
  // Try RPCs until one works
  let provider;
  let ctf;
  for (const rpc of RPC_URLS) {
    try {
      provider = new ethers.providers.JsonRpcProvider(rpc);
      ctf = new ethers.Contract(CTF_ADDRESS, CTF_ABI, provider);
      // Test connection
      await provider.getBlockNumber();
      console.log(`Connected to RPC: ${rpc}`);
      break;
    } catch (e) {
      console.log(`RPC ${rpc} failed, trying next...`);
    }
  }
  if (!ctf) {
    console.error("All RPCs failed");
    process.exit(1);
  }

  // Connect to DB
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  
  const conn = await mysql.createConnection(dbUrl);
  
  // Get all open positions
  const [rows] = await conn.execute(
    "SELECT id, tokenId, question, shares, costBasis, entryPrice FROM positions WHERE status = 'open' ORDER BY id"
  );

  console.log(`\nChecking ${rows.length} open positions on-chain...\n`);
  
  let realPositions = 0;
  let phantomPositions = 0;
  let realCostBasis = 0;
  let phantomCostBasis = 0;
  let errors = 0;

  const results = [];

  for (const pos of rows) {
    try {
      // CTF tokens use the tokenId as the ERC-1155 id
      // balanceOf returns raw amount (no decimals for CTF outcome tokens - they use 6 decimals like USDC)
      const balance = await ctf.balanceOf(WALLET, pos.tokenId);
      const balanceNum = parseFloat(ethers.utils.formatUnits(balance, 6));
      const dbShares = parseFloat(pos.shares);
      const costBasis = parseFloat(pos.costBasis);
      
      const isReal = balanceNum > 0.001; // threshold to account for dust
      
      if (isReal) {
        realPositions++;
        realCostBasis += costBasis;
      } else {
        phantomPositions++;
        phantomCostBasis += costBasis;
      }

      results.push({
        id: pos.id,
        question: pos.question.substring(0, 60),
        dbShares: dbShares.toFixed(2),
        onChainBalance: balanceNum.toFixed(2),
        costBasis: costBasis.toFixed(2),
        status: isReal ? "REAL" : "PHANTOM"
      });

      if (results.length % 10 === 0) {
        console.log(`  Checked ${results.length}/${rows.length}...`);
      }

      // Rate limit to avoid RPC throttling
      await new Promise(r => setTimeout(r, 150));
    } catch (err) {
      errors++;
      results.push({
        id: pos.id,
        question: pos.question.substring(0, 60),
        dbShares: parseFloat(pos.shares).toFixed(2),
        onChainBalance: "ERROR",
        costBasis: parseFloat(pos.costBasis).toFixed(2),
        status: "ERROR: " + err.message?.substring(0, 50)
      });
    }
  }

  console.log("\n=== RESULTS ===");
  console.log(`Real positions:    ${realPositions} ($${realCostBasis.toFixed(2)} cost basis)`);
  console.log(`Phantom positions: ${phantomPositions} ($${phantomCostBasis.toFixed(2)} cost basis)`);
  console.log(`Errors:            ${errors}`);
  console.log(`\nTotal "open" in DB: ${rows.length}`);
  console.log(`Actual on-chain:    ${realPositions}`);
  console.log(`\nDashboard shows $${(realCostBasis + phantomCostBasis).toFixed(2)} deployed`);
  console.log(`Actual deployed:    $${realCostBasis.toFixed(2)}`);
  console.log(`Phantom capital:    $${phantomCostBasis.toFixed(2)}`);

  // Print all results
  console.log("\n=== ALL POSITIONS ===");
  for (const r of results) {
    console.log(`[${r.status.padEnd(7)}] #${String(r.id).padStart(3)} | On-chain: ${r.onChainBalance.padStart(10)} | DB: ${r.dbShares.padStart(10)} | $${r.costBasis.padStart(6)} | ${r.question}`);
  }

  // Save full results to file
  const fs = await import("fs");
  fs.writeFileSync("/home/ubuntu/position_audit.json", JSON.stringify(results, null, 2));
  console.log("\nFull results saved to /home/ubuntu/position_audit.json");

  await conn.end();
}

main().catch(console.error);
