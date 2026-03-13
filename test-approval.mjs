/**
 * Test: Check and set USDC.e approval for Polymarket CTF Exchange
 * 
 * Polymarket uses two exchange contracts:
 * - CTF Exchange: 0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E
 * - Neg Risk CTF Exchange: 0xC5d563A36AE78145C45a50134d48A1215220f80a
 * 
 * USDC.e on Polygon: 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
 * 
 * We need to approve both exchange contracts to spend USDC.e
 */
import pkg from "ethers";
const { Wallet, Contract, providers, constants } = pkg;
const { JsonRpcProvider } = providers;
const MaxUint256 = constants.MaxUint256;
import dotenv from "dotenv";
dotenv.config();

const POLYGON_RPC = "https://rpc.ankr.com/polygon";
const USDC_E_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const CTF_EXCHANGE = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const NEG_RISK_CTF_EXCHANGE = "0xC5d563A36AE78145C45a50134d48A1215220f80a";
const NEG_RISK_ADAPTER = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296";

const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

async function main() {
  const pk = process.env.POLYGON_PRIVATE_KEY;
  const formattedKey = pk.startsWith("0x") ? pk : `0x${pk}`;
  
  const provider = new JsonRpcProvider(POLYGON_RPC);
  const wallet = new Wallet(formattedKey, provider);
  console.log(`Wallet: ${wallet.address}`);

  const usdc = new Contract(USDC_E_ADDRESS, ERC20_ABI, wallet);
  
  // Check balance
  const balance = await usdc.balanceOf(wallet.address);
  const decimals = await usdc.decimals();
  console.log(`USDC.e Balance: ${Number(balance) / (10 ** Number(decimals))} USDC.e`);

  // Check POL balance for gas
  const polBalance = await provider.getBalance(wallet.address);
  console.log(`POL Balance: ${Number(polBalance) / 1e18} POL`);

  // Check current allowances
  const spenders = [
    { name: "CTF Exchange", address: CTF_EXCHANGE },
    { name: "Neg Risk CTF Exchange", address: NEG_RISK_CTF_EXCHANGE },
    { name: "Neg Risk Adapter", address: NEG_RISK_ADAPTER },
  ];

  for (const spender of spenders) {
    const allowance = await usdc.allowance(wallet.address, spender.address);
    const allowanceFormatted = Number(allowance) / (10 ** Number(decimals));
    console.log(`\n${spender.name} (${spender.address}):`);
    console.log(`  Allowance: ${allowanceFormatted} USDC.e`);
    
    if (allowanceFormatted < 1000000) {
      console.log(`  → Needs approval! Approving max...`);
      try {
        const tx = await usdc.approve(spender.address, MaxUint256);
        console.log(`  → Tx hash: ${tx.hash}`);
        console.log(`  → Waiting for confirmation...`);
        const receipt = await tx.wait();
        console.log(`  → Approved! Block: ${receipt.blockNumber}, Gas used: ${receipt.gasUsed.toString()}`);
      } catch (err) {
        console.error(`  → Approval failed: ${err.message}`);
      }
    } else {
      console.log(`  → Already approved`);
    }
  }

  console.log("\n=== Done! ===");
}

main().catch(e => console.error("Fatal:", e.message));
