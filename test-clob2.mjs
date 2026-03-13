import 'dotenv/config';
import { ClobClient, SignatureType } from "@polymarket/clob-client";
import { Wallet } from "ethers";

const CLOB_HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;

async function main() {
  const privateKey = process.env.POLYGON_PRIVATE_KEY;
  const wallet = new Wallet(privateKey);

  console.log("Wallet:", wallet.address);

  // Step 1: Create unauthenticated client
  const unauthClient = new ClobClient(CLOB_HOST, CHAIN_ID, wallet, undefined, SignatureType.EOA);

  // Step 2: Derive API key - inspect the full response
  console.log("\n=== Deriving API key ===");
  const creds = await unauthClient.createApiKey();
  console.log("Full createApiKey response:", JSON.stringify(creds, null, 2));

  // Step 3: Also try deriving with different nonce
  console.log("\n=== Trying deriveApiKey ===");
  try {
    const derived = await unauthClient.deriveApiKey();
    console.log("Full deriveApiKey response:", JSON.stringify(derived, null, 2));
  } catch (e) {
    console.log("deriveApiKey error:", e.message);
  }

  // Step 4: Try getApiKeys to see if any exist
  console.log("\n=== Checking existing API keys ===");
  try {
    // Use the creds we got
    const authClient = new ClobClient(
      CLOB_HOST,
      CHAIN_ID,
      wallet,
      creds,
      SignatureType.EOA,
    );
    const keys = await authClient.getApiKeys();
    console.log("Existing API keys:", JSON.stringify(keys, null, 2));
  } catch (e) {
    console.log("getApiKeys error:", e.message);
  }

  // Step 5: Try creating with createOrDeriveApiKey
  console.log("\n=== Trying createOrDeriveApiKey ===");
  try {
    const result = await unauthClient.createOrDeriveApiKey();
    console.log("createOrDeriveApiKey response:", JSON.stringify(result, null, 2));
  } catch (e) {
    console.log("createOrDeriveApiKey error:", e.message);
  }
}

main().catch(console.error);
