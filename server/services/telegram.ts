import axios from "axios";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

export async function sendTelegramAlert(message: string) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: `🚀 Polymarket Bot [Frankfurt 165.227.132.17]\n${message}`,
      parse_mode: "HTML",
    });
  } catch (e) {
    // Silently fail — Telegram alerts are best-effort
  }
}
