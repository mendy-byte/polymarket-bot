import 'dotenv/config';

const pk = process.env.POLYGON_PRIVATE_KEY;
const addr = process.env.POLYGON_WALLET_ADDRESS;

console.log("Private Key set:", Boolean(pk), pk ? "(length: " + pk.length + ")" : "(empty)");
console.log("Wallet Address set:", Boolean(addr), addr ? addr : "(empty)");
