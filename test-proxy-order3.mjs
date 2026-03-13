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
  const agent = new SocksProxyAgent(PROXY_URL);
  
  // Set axios defaults - this affects ALL axios requests globally
  // The CLOB client uses the default axios instance
  axios.defaults.httpAgent = agent;
  axios.defaults.httpsAgent = agent;
  axios.defaults.proxy = false;

  const pk = process.env.POLYGON_PRIVATE_KEY;
  const formattedKey = pk.startsWith("0x") ? pk : `0x${pk}`;
  const signer = new Wallet(formattedKey);
  console.log(`Wallet: ${signer.address}`);

  const tempClient = new ClobClient(CLOB_HOST, CHAIN_ID, signer, undefined, SignatureType.EOA);
  const creds = await tempClient.deriveApiKey();
  const apiKey = creds.key || creds.apiKey;
  console.log(`API Key derived: ${apiKey ? "yes" : "no"}`);

  const client = new ClobClient(
    CLOB_HOST, CHAIN_ID, signer,
    { key: apiKey, secret: creds.secret, passphrase: creds.passphrase },
    SignatureType.EOA, signer.address
  );

  // Find a cheap market
  console.log("Scanning for cheap markets...");
  const gammaResp = await axios.get("https://gamma-api.polymarket.com/markets", {
    params: { active: true, closed: false, limit: 500 },
    timeout: 30000,
  });
  
  const markets = gammaResp.data || [];
  let target = null;
  
  for (const m of markets) {
    try {
      const prices = JSON.parse(m.outcomePrices || "[]");
      const outcomes = JSON.parse(m.outcomes || "[]");
      const tokenIds = JSON.parse(m.clobTokenIds || "[]");
      const volume = parseFloat(m.volume || "0");
      for (let i = 0; i < prices.length; i++) {
        const p = parseFloat(prices[i]);
        if (p >= 0.01 && p <= 0.03 && tokenIds[i] && volume > 1000) {
          target = { question: m.question, outcome: outcomes[i], price: p, tokenId: tokenIds[i], volume, negRisk: m.negRisk === true || m.negRisk === "true" };
          break;
        }
      }
    } catch (e) { continue; }
    if (target) break;
  }

  if (!target) { console.log("No cheap market found"); return; }

  console.log(`Target: "${target.question}" - ${target.outcome}`);
  console.log(`Price: $${target.price}`);

  const orderSize = Math.floor(1 / target.price);
  console.log(`Placing: BUY ${orderSize} shares @ $${target.price}`);

  const response = await client.createAndPostOrder(
    { tokenID: target.tokenId, price: target.price, size: orderSize, side: Side.BUY },
    { tickSize: "0.01", negRisk: target.negRisk },
    OrderType.GTC,
  );

  console.log("Response:", JSON.stringify(response, null, 2));
  if (response?.orderID) console.log(`\n✅ ORDER PLACED! ID: ${response.orderID}`);
  else if (response?.errorMsg) console.log(`\n❌ Failed: ${response.errorMsg}`);
  else console.log("Response:", response);
}

main().catch(e => console.error("Fatal:", e.message));
