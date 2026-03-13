import 'dotenv/config';
import { ClobClient, SignatureType } from "@polymarket/clob-client";
import { Wallet } from "ethers";

const CLOB_HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;

async function main() {
  const privateKey = process.env.POLYGON_PRIVATE_KEY;
  const walletAddress = process.env.POLYGON_WALLET_ADDRESS;

  if (!privateKey) {
    console.error("No POLYGON_PRIVATE_KEY set");
    process.exit(1);
  }

  console.log("=== Step 1: Create wallet from private key ===");
  const wallet = new Wallet(privateKey);
  console.log("Wallet address:", wallet.address);
  console.log("Matches env:", wallet.address.toLowerCase() === (walletAddress || "").toLowerCase());

  console.log("\n=== Step 2: Derive CLOB API credentials ===");
  try {
    const client = new ClobClient(CLOB_HOST, CHAIN_ID, wallet, undefined, SignatureType.EOA);
    const creds = await client.createApiKey();
    console.log("API Key derived:", creds.apiKey ? "YES (length: " + creds.apiKey.length + ")" : "NO");
    console.log("API Secret:", creds.secret ? "YES" : "NO");
    console.log("Passphrase:", creds.passphrase ? "YES" : "NO");

    console.log("\n=== Step 3: Initialize authenticated client ===");
    const authClient = new ClobClient(
      CLOB_HOST,
      CHAIN_ID,
      wallet,
      {
        key: creds.apiKey,
        secret: creds.secret,
        passphrase: creds.passphrase,
      },
      SignatureType.EOA,
    );

    console.log("\n=== Step 4: Test API connection ===");
    const serverTime = await authClient.getServerTime();
    console.log("Server time:", serverTime);

    console.log("\n=== Step 5: Check balance/allowance ===");
    try {
      // Try to get open orders as a connectivity test
      const openOrders = await authClient.getOpenOrders();
      console.log("Open orders:", openOrders ? openOrders.length || 0 : 0);
    } catch (e) {
      console.log("Open orders check:", e.message);
    }

    console.log("\n=== SUCCESS: CLOB client is connected and ready ===");
    console.log("Credentials:");
    console.log("  API Key:", creds.apiKey);
    console.log("  Secret:", creds.secret);
    console.log("  Passphrase:", creds.passphrase);

  } catch (err) {
    console.error("CLOB initialization failed:", err.message);
    console.error("Full error:", err);
    process.exit(1);
  }
}

main();
