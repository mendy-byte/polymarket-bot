import { describe, it, expect } from "vitest";

describe("Telegram Integration", () => {
  it("should have TELEGRAM_BOT_TOKEN set", () => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    expect(token).toBeDefined();
    expect(token!.length).toBeGreaterThan(10);
  });

  it("should have TELEGRAM_CHAT_ID set", () => {
    const chatId = process.env.TELEGRAM_CHAT_ID;
    expect(chatId).toBeDefined();
    expect(chatId!.length).toBeGreaterThan(0);
  });

  it("should successfully send a test message via Telegram API", async () => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      console.log("Skipping: Telegram credentials not set");
      return;
    }

    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "✅ Polymarket Bot: Telegram integration test successful!",
          parse_mode: "HTML",
        }),
      }
    );

    const data = await response.json();
    expect(data.ok).toBe(true);
  });
});
