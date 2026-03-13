/**
 * Test: Place a real $1 order through Amsterdam proxy
 * Fixed: price floor at 0.001
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
  // Set up proxy
  const agent = new SocksProxyAgent(PROXY_URL);
  axios.interceptors.request.use((config) => {
    if ((config.url || "").includes("clob.polymarket.com")) {
      config.httpAgent = agent;
      config.httpsAgent = agent;
      config.proxy = false;
    }
    return config;
  });

  // Initialize wallet and CLOB client
  const pk = process.env.POLYGON_PRIVATE_KEY;
  const formattedKey = pk.startsWith("0x") ? pk : `0x${pk}`;
  const signer = new Wallet(formattedKey);
  console.log(`Wallet: ${signer.address}`);

  const tempClient = new ClobClient(CLOB_HOST, CHAIN_ID, signer, undefined, SignatureType.EOA);
  const creds = await tempClient.deriveApiKey();
  const apiKey = creds.key || creds.apiKey;

  const client = new ClobClient(
    CLOB_HOST, CHAIN_ID, signer,
    { key: apiKey, secret: creds.secret, passphrase: creds.passphrase },
    SignatureType.EOA, signer.address
  );

  // Find a cheap market with price between 0.01 and 0.03 (safe range)
  console.log("Scanning for cheap markets...");
  const gammaResp = await axios.get("https://gamma-api.polymarket.com/markets", {
    params: { active: true, closed: false, limit: 500 },
    timeout: 30000,
  });
  
  const markets = gammaResp.data || [];
  let candidates = [];
  
  for (const m of markets) {
    try {
      const prices = JSON.parse(m.outcomePrices || "[]");
      const outcomes = JSON.parse(m.outcomes || "[]");
      const tokenIds = JSON.parse(m.clobTokenIds || "[]");
      const volume = parseFloat(m.volume || "0");
      
      for (let i = 0; i < prices.length; i++) {
        const p = parseFloat(prices[i]);
        // Price between 1 and 3 cents, has token ID, has some volume
        if (p >= 0.01 && p <= 0.03 && tokenIds[i] && volume > 1000) {
          candidates.push({
            question: m.question,
            outcome: outcomes[i],
            price: p,
            tokenId: tokenIds[i],
            volume,
            negRisk: m.negRisk === true || m.negRisk === "true",
          });
        }
      }
    } catch (e) { continue; }
  }

  console.log(`Found ${candidates.length} candidates in 1-3 cent range`);
  
  if (candidates.length === 0) {
    // Broaden to 0.01 - 0.05
    for (const m of markets) {
      try {
        const prices = JSON.parse(m.outcomePrices || "[]");
        const outcomes = JSON.parse(m.outcomes || "[]");
        const tokenIds = JSON.parse(m.clobTokenIds || "[]");
        for (let i = 0; i < prices.length; i++) {
          const p = parseFloat(prices[i]);
          if (p >= 0.01 && p <= 0.05 && tokenIds[i]) {
            candidates.push({
              question: m.question,
              outcome: outcomes[i],
              price: p,
              tokenId: tokenIds[i],
              volume: parseFloat(m.volume || "0"),
              negRisk: m.negRisk === true || m.negRisk === "true",
            });
          }
        }
      } catch (e) { continue; }
    }
    console.log(`Broadened search: ${candidates.length} candidates at 1-5 cents`);
  }

  if (candidates.length === 0) {
    console.log("No suitable markets found. Exiting.");
    return;
  }

  // Sort by volume (most liquid first)
  candidates.sort((a, b) => b.volume - a.volume);
  const target = candidates[0];

  console.log(`\nTarget: "${target.question}"`);
  console.log(`Outcome: ${target.outcome}`);
  console.log(`Price: $${target.price}, Volume: $${target.volume.toLocaleString()}`);
  console.log(`NegRisk: ${target.negRisk}`);

  // Place a $1 order
  const orderPrice = target.price;
  const orderSize = Math.floor(1 / orderPrice);
  const tickSize = "0.01"; // Safe for prices >= 0.01
  
  console.log(`\nPlacing: BUY ${orderSize} shares @ $${orderPrice} = ~$${(orderSize * orderPrice).toFixed(2)}`);

  try {
    const response = await client.createAndPostOrder(
      {
        tokenID: target.tokenId,
        price: orderPrice,
        size: orderSize,
        side: Side.BUY,
      },
      { tickSize, negRisk: target.negRisk },
      OrderType.GTC,
    );

    console.log("\n=== ORDER RESPONSE ===");
    console.log(JSON.stringify(response, null, 2));

    if (response && response.orderID) {
      console.log(`\n✅ ORDER PLACED! ID: ${response.orderID}`);
    } else if (response && response.errorMsg) {
      console.log(`\n❌ Failed: ${response.errorMsg}`);
    }
  } catch (err) {
    console.error(`\n❌ Order error: ${err.message}`);
    if (err.response) {
      console.error(`Status: ${err.response.status}`);
      console.error(`Data: ${JSON.stringify(err.response.data)}`);
    }
  }
}

main().catch(console.error);
