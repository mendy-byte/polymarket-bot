import 'dotenv/config';
import { ClobClient, Side, OrderType, SignatureType } from "@polymarket/clob-client";
import { Wallet } from "ethers";

const CLOB_HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;

async function main() {
  const privateKey = process.env.POLYGON_PRIVATE_KEY;
  const wallet = new Wallet(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`);

  console.log("Wallet:", wallet.address);

  // Step 1: Derive credentials
  console.log("\n=== Deriving CLOB credentials ===");
  const tempClient = new ClobClient(CLOB_HOST, CHAIN_ID, wallet, undefined, SignatureType.EOA);
  const creds = await tempClient.deriveApiKey();
  console.log("API Key:", creds.key);
  console.log("Secret:", creds.secret ? "YES" : "NO");
  console.log("Passphrase:", creds.passphrase ? "YES" : "NO");

  // Step 2: Create authenticated client
  console.log("\n=== Creating authenticated client ===");
  const client = new ClobClient(
    CLOB_HOST,
    CHAIN_ID,
    wallet,
    { key: creds.key, secret: creds.secret, passphrase: creds.passphrase },
    SignatureType.EOA,
    wallet.address,
  );

  // Step 3: Verify connection
  const ok = await client.getOk();
  console.log("Server OK:", ok);

  const serverTime = await client.getServerTime();
  console.log("Server time:", serverTime);

  // Step 4: Check open orders (test auth)
  console.log("\n=== Testing authenticated endpoints ===");
  try {
    const openOrders = await client.getOpenOrders();
    console.log("Open orders:", Array.isArray(openOrders) ? openOrders.length : "N/A");
  } catch (e) {
    console.log("Open orders error:", e.message);
  }

  // Step 5: Find a cheap market to test with
  console.log("\n=== Finding a cheap market for test order ===");
  const resp = await fetch("https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=100");
  const markets = await resp.json();

  let testMarket = null;
  for (const m of markets) {
    if (!m.clobTokenIds || !m.outcomePrices) continue;
    try {
      const prices = JSON.parse(m.outcomePrices);
      const tokenIds = JSON.parse(m.clobTokenIds);
      for (let i = 0; i < prices.length; i++) {
        const price = parseFloat(prices[i]);
        if (price > 0.005 && price <= 0.03 && tokenIds[i]) {
          testMarket = {
            question: m.question,
            tokenId: tokenIds[i],
            price: price,
            conditionId: m.conditionId,
            negRisk: m.negRisk || false,
          };
          break;
        }
      }
    } catch (e) { continue; }
    if (testMarket) break;
  }

  if (!testMarket) {
    console.log("No cheap market found for testing");
    return;
  }

  console.log("Test market:", testMarket.question);
  console.log("Token ID:", testMarket.tokenId);
  console.log("Price:", testMarket.price);
  console.log("Neg Risk:", testMarket.negRisk);

  // Step 6: Get tick size for this market
  console.log("\n=== Getting tick size ===");
  let tickSize = "0.01";
  try {
    const ts = await client.getTickSize(testMarket.tokenId);
    tickSize = ts;
    console.log("Tick size:", tickSize);
  } catch (e) {
    console.log("Tick size error (using default 0.01):", e.message);
  }

  // Step 7: Place a small test order ($1)
  const size = Math.floor(1 / testMarket.price); // $1 worth of shares
  console.log(`\n=== Placing test order: ${size} shares @ $${testMarket.price} ($${(size * testMarket.price).toFixed(2)}) ===`);

  try {
    const result = await client.createAndPostOrder(
      {
        tokenID: testMarket.tokenId,
        price: testMarket.price,
        size: size,
        side: Side.BUY,
      },
      {
        tickSize: tickSize,
        negRisk: testMarket.negRisk,
      },
      OrderType.GTC,
    );

    console.log("\n=== ORDER RESULT ===");
    console.log(JSON.stringify(result, null, 2));

    if (result && result.orderID) {
      console.log("\nSUCCESS! Order placed:", result.orderID);
    } else if (result && result.errorMsg) {
      console.log("\nOrder failed:", result.errorMsg);
    } else {
      console.log("\nUnexpected response:", result);
    }
  } catch (e) {
    console.error("\nOrder placement error:", e.message);
    if (e.response) {
      console.error("Response data:", JSON.stringify(e.response.data, null, 2));
    }
  }
}

main().catch(console.error);
