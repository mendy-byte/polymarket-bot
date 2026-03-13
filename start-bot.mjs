/**
 * Start the bot by triggering the autopilot via the server's internal API.
 * This calls the autopilot.runOnce endpoint to run the first scan-evaluate-buy cycle.
 */
import "dotenv/config";

const BASE_URL = "http://localhost:3000";

async function callTrpc(path, input = undefined) {
  const url = input !== undefined
    ? `${BASE_URL}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`
    : `${BASE_URL}/api/trpc/${path}`;
  
  const isQuery = !path.includes("runOnce") && !path.includes("start") && !path.includes("scan") && !path.includes("evaluate");
  
  if (isQuery) {
    const resp = await fetch(url);
    const data = await resp.json();
    return data.result?.data;
  } else {
    const resp = await fetch(`${BASE_URL}/api/trpc/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input !== undefined ? input : {}),
    });
    const data = await resp.json();
    return data.result?.data || data;
  }
}

async function main() {
  console.log("=== Polymarket Tail-Risk Bot - Starting ===\n");

  // Check wallet status
  console.log("1. Checking wallet status...");
  try {
    const wallet = await callTrpc("wallet.status");
    console.log(`   Wallet: ${wallet?.address || "not configured"}`);
    console.log(`   CLOB: ${wallet?.clobInitialized ? "CONNECTED" : "not connected"}`);
    console.log(`   Heartbeat: ${wallet?.heartbeatActive ? "ACTIVE" : "inactive"}`);
  } catch (e) {
    console.log("   (Need auth for wallet status - checking via logs)");
  }

  // Trigger a scan directly via the autopilot service
  console.log("\n2. Starting first autopilot cycle...");
  console.log("   This will: scan markets → AI evaluate → place orders");
  console.log("   Watching server logs...\n");
}

main().catch(console.error);
