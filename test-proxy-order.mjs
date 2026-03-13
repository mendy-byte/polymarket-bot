/**
 * Test: Initialize SOCKS5 proxy → Connect CLOB → Place a real order
 */
import axios from "axios";
import { SocksProxyAgent } from "socks-proxy-agent";
import { ClobClient, Side, OrderType, SignatureType } from "@polymarket/clob-client";
import { Wallet } from "ethers";
import dotenv from "dotenv";
dotenv.config();

const PROXY_URL = "socks5://152.42.139.184:1080";
const CLOB_HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;

async function main() {
  console.log("=== Step 1: Initialize SOCKS5 Proxy ===");
  const agent = new SocksProxyAgent(PROXY_URL);
  
  // Patch axios globally for CLOB requests
  axios.interceptors.request.use((config) => {
    const url = config.url || "";
    if (url.includes("clob.polymarket.com")) {
      config.httpAgent = agent;
      config.httpsAgent = agent;
      config.proxy = false;
    }
    return config;
  });

  // Verify proxy works
  const ipResp = await axios.get("https://ifconfig.me/ip", {
    httpAgent: agent, httpsAgent: agent, proxy: false, timeout: 10000
  });
  console.log(`Proxy exit IP: ${ipResp.data.trim()}`);

  console.log("\n=== Step 2: Initialize CLOB Client ===");
  const pk = process.env.POLYGON_PRIVATE_KEY;
  if (!pk) { console.error("No POLYGON_PRIVATE_KEY"); process.exit(1); }
  
  const formattedKey = pk.startsWith("0x") ? pk : `0x${pk}`;
  const signer = new Wallet(formattedKey);
  console.log(`Wallet: ${signer.address}`);

  // Test server connectivity through proxy
  const tempClient = new ClobClient(CLOB_HOST, CHAIN_ID, signer, undefined, SignatureType.EOA);
  const serverTime = await tempClient.getServerTime();
  console.log(`Server time: ${serverTime}`);

  // Derive API credentials
  console.log("Deriving API credentials...");
  const creds = await tempClient.deriveApiKey();
  const apiKey = creds.key || creds.apiKey;
  console.log(`API Key: ${apiKey ? apiKey.slice(0, 12) + "..." : "MISSING"}`);
  console.log(`Secret: ${creds.secret ? creds.secret.slice(0, 12) + "..." : "MISSING"}`);
  console.log(`Passphrase: ${creds.passphrase ? creds.passphrase.slice(0, 12) + "..." : "MISSING"}`);

  if (!apiKey) { console.error("Failed to derive API key"); process.exit(1); }

  // Create authenticated client
  const client = new ClobClient(
    CLOB_HOST, CHAIN_ID, signer,
    { key: apiKey, secret: creds.secret, passphrase: creds.passphrase },
    SignatureType.EOA, signer.address
  );

  // Check open orders (authenticated endpoint)
  console.log("\n=== Step 3: Test Authenticated Endpoints ===");
  try {
    const openOrders = await client.getOpenOrders();
    console.log(`Open orders: ${JSON.stringify(openOrders).slice(0, 200)}`);
  } catch (err) {
    console.error(`Open orders failed: ${err.message}`);
  }

  // Now try to find a cheap market and place an order
  console.log("\n=== Step 4: Find Cheap Market & Place Order ===");
  try {
    // Fetch a cheap market from Gamma API (doesn't need proxy)
    const gammaResp = await axios.get("https://gamma-api.polymarket.com/markets", {
      params: { active: true, closed: false, limit: 50, order: "volume", ascending: false },
      timeout: 15000,
    });
    
    const markets = gammaResp.data || [];
    let targetMarket = null;
    
    for (const m of markets) {
      try {
        const prices = JSON.parse(m.outcomePrices || "[]");
        const outcomes = JSON.parse(m.outcomes || "[]");
        for (let i = 0; i < prices.length; i++) {
          const p = parseFloat(prices[i]);
          if (p > 0 && p <= 0.03 && m.clobTokenIds) {
            const tokenIds = JSON.parse(m.clobTokenIds || "[]");
            if (tokenIds[i]) {
              targetMarket = {
                question: m.question,
                outcome: outcomes[i],
                price: p,
                tokenId: tokenIds[i],
                conditionId: m.conditionId,
                negRisk: m.negRisk === true || m.negRisk === "true",
              };
              break;
            }
          }
        }
      } catch (e) { continue; }
      if (targetMarket) break;
    }

    if (!targetMarket) {
      console.log("No cheap market found in first 50 results. Trying broader search...");
      // Try a broader search
      const gammaResp2 = await axios.get("https://gamma-api.polymarket.com/markets", {
        params: { active: true, closed: false, limit: 200 },
        timeout: 15000,
      });
      const markets2 = gammaResp2.data || [];
      for (const m of markets2) {
        try {
          const prices = JSON.parse(m.outcomePrices || "[]");
          const outcomes = JSON.parse(m.outcomes || "[]");
          for (let i = 0; i < prices.length; i++) {
            const p = parseFloat(prices[i]);
            if (p > 0 && p <= 0.05 && m.clobTokenIds) {
              const tokenIds = JSON.parse(m.clobTokenIds || "[]");
              if (tokenIds[i]) {
                targetMarket = {
                  question: m.question,
                  outcome: outcomes[i],
                  price: p,
                  tokenId: tokenIds[i],
                  conditionId: m.conditionId,
                  negRisk: m.negRisk === true || m.negRisk === "true",
                };
                break;
              }
            }
          }
        } catch (e) { continue; }
        if (targetMarket) break;
      }
    }

    if (!targetMarket) {
      console.log("No cheap market found. Skipping order test.");
      return;
    }

    console.log(`Target: "${targetMarket.question}" - ${targetMarket.outcome}`);
    console.log(`Price: $${targetMarket.price}, Token: ${targetMarket.tokenId.slice(0, 20)}...`);
    console.log(`NegRisk: ${targetMarket.negRisk}`);

    // Calculate size: $1 / price = number of shares
    const orderPrice = targetMarket.price;
    const orderSize = Math.floor(1 / orderPrice); // ~$1 worth
    console.log(`\nPlacing order: ${orderSize} shares @ $${orderPrice} (~$${(orderSize * orderPrice).toFixed(2)} total)`);

    // Determine tick size based on price
    const tickSize = orderPrice < 0.01 ? "0.001" : "0.01";

    const response = await client.createAndPostOrder(
      {
        tokenID: targetMarket.tokenId,
        price: orderPrice,
        size: orderSize,
        side: Side.BUY,
      },
      { tickSize, negRisk: targetMarket.negRisk },
      OrderType.GTC,
    );

    console.log("\n=== ORDER RESPONSE ===");
    console.log(JSON.stringify(response, null, 2));

    if (response && response.orderID) {
      console.log(`\n✅ ORDER PLACED SUCCESSFULLY! Order ID: ${response.orderID}`);
    } else if (response && response.errorMsg) {
      console.log(`\n❌ Order failed: ${response.errorMsg}`);
    } else {
      console.log(`\nResponse: ${JSON.stringify(response)}`);
    }

  } catch (err) {
    console.error(`Order test failed: ${err.message}`);
    if (err.response) {
      console.error(`Status: ${err.response.status}`);
      console.error(`Data: ${JSON.stringify(err.response.data)}`);
    }
  }
}

main().catch(console.error);
