// This script reads env vars and outputs the approval script for the remote server
import dotenv from "dotenv";
dotenv.config();

const pk = process.env.POLYGON_PRIVATE_KEY;
const wallet = process.env.POLYGON_WALLET_ADDRESS;

// Output a self-contained Node.js script that can run on the DO droplet
const script = `
const { Wallet, Contract, providers, constants } = require("ethers");

const POLYGON_RPC = "https://polygon-bor-rpc.publicnode.com";
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
  const pk = "${pk}";
  const formattedKey = pk.startsWith("0x") ? pk : "0x" + pk;
  
  const provider = new providers.JsonRpcProvider(POLYGON_RPC);
  const wallet = new Wallet(formattedKey, provider);
  console.log("Wallet:", wallet.address);

  const usdc = new Contract(USDC_E_ADDRESS, ERC20_ABI, wallet);
  
  const balance = await usdc.balanceOf(wallet.address);
  const decimals = await usdc.decimals();
  console.log("USDC.e Balance:", (Number(balance) / (10 ** decimals)).toFixed(6));

  const polBalance = await provider.getBalance(wallet.address);
  console.log("POL Balance:", (Number(polBalance) / 1e18).toFixed(6));

  const spenders = [
    { name: "CTF Exchange", address: CTF_EXCHANGE },
    { name: "Neg Risk CTF Exchange", address: NEG_RISK_CTF_EXCHANGE },
    { name: "Neg Risk Adapter", address: NEG_RISK_ADAPTER },
  ];

  for (const spender of spenders) {
    const allowance = await usdc.allowance(wallet.address, spender.address);
    const allowanceFormatted = Number(allowance) / (10 ** decimals);
    console.log("\\n" + spender.name + " (" + spender.address + "):");
    console.log("  Allowance:", allowanceFormatted, "USDC.e");
    
    if (allowanceFormatted < 1000000) {
      console.log("  Needs approval! Approving max...");
      try {
        // Get current gas price and add buffer
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice.mul(2); // 2x current gas price for safety
        const tx = await usdc.approve(spender.address, constants.MaxUint256, { gasPrice });
        console.log("  Tx hash:", tx.hash);
        console.log("  Waiting for confirmation...");
        const receipt = await tx.wait();
        console.log("  APPROVED! Block:", receipt.blockNumber, "Gas:", receipt.gasUsed.toString());
      } catch (err) {
        console.error("  Approval failed:", err.message);
      }
    } else {
      console.log("  Already approved");
    }
  }
  console.log("\\n=== All approvals complete! ===");
}

main().catch(e => console.error("Fatal:", e.message));
`;

// Write the script to a temp file that we'll SCP to the droplet
import { writeFileSync } from "fs";
writeFileSync("/tmp/remote-approval.js", script);
console.log("Remote script written to /tmp/remote-approval.js");
console.log("Wallet:", wallet);
