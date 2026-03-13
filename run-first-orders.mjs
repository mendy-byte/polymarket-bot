/**
 * Run a focused first batch: evaluate top events and place orders.
 * Skips the full scan (already done - 3586 events in DB) and goes straight
 * to AI evaluation + order placement.
 */
import "dotenv/config";
import { getDb } from "./server/db.ts";
import { sql } from "drizzle-orm";
import { evaluateBatch } from "./server/services/aiEvaluator.ts";
import { initializeClobClient, placeLimitOrder, getClobStatus } from "./server/services/clobTrader.ts";
import { analyzeOrderbook } from "./server/services/gammaApi.ts";

async function main() {
  const db = await getDb();
  if (!db) { console.error("No DB"); return; }

  // Step 1: Initialize CLOB
  console.log("=== Step 1: Initialize CLOB ===");
  const clobStatus = getClobStatus();
  if (!clobStatus.initialized) {
    const init = await initializeClobClient();
    console.log("CLOB init:", init.success ? "SUCCESS" : init.error);
    if (!init.success) return;
  } else {
    console.log("CLOB already initialized");
  }

  // Step 2: Get unevaluated events with good liquidity, sorted by liquidity desc
  console.log("\n=== Step 2: Get top unevaluated events ===");
  const events = await db.execute(sql`
    SELECT id, marketId, conditionId, tokenId, question, outcome, price, liquidity, volume, 
           endDate, category, tags, tickSize, negRisk, hoursToResolution, slug, eventSlug
    FROM scanned_events 
    WHERE aiScore IS NULL 
      AND status = 'discovered'
      AND CAST(price AS DECIMAL(10,6)) >= 0.005
      AND CAST(price AS DECIMAL(10,6)) <= 0.03
      AND CAST(liquidity AS DECIMAL(20,2)) >= 5000
    ORDER BY CAST(liquidity AS DECIMAL(20,2)) DESC
    LIMIT 20
  `);
  
  const rows = events[0];
  console.log(`Found ${rows.length} high-liquidity unevaluated events`);
  
  if (rows.length === 0) {
    console.log("No events to evaluate. Trying with lower liquidity threshold...");
    const events2 = await db.execute(sql`
      SELECT id, marketId, conditionId, tokenId, question, outcome, price, liquidity, volume, 
             endDate, category, tags, tickSize, negRisk, hoursToResolution, slug, eventSlug
      FROM scanned_events 
      WHERE aiScore IS NULL 
        AND status = 'discovered'
        AND CAST(price AS DECIMAL(10,6)) >= 0.005
        AND CAST(price AS DECIMAL(10,6)) <= 0.03
      ORDER BY CAST(liquidity AS DECIMAL(20,2)) DESC
      LIMIT 20
    `);
    rows.push(...events2[0]);
    console.log(`Found ${rows.length} events with relaxed filters`);
  }

  for (const e of rows.slice(0, 5)) {
    console.log(`  ${e.question} - ${e.outcome} @ $${e.price} (liq: $${e.liquidity})`);
  }

  // Step 3: AI evaluate
  console.log("\n=== Step 3: AI Evaluation ===");
  const outcomes = rows.map(e => ({
    marketId: e.marketId,
    conditionId: e.conditionId || "",
    tokenId: e.tokenId || "",
    question: e.question,
    outcome: e.outcome,
    outcomeIndex: 0,
    price: parseFloat(e.price),
    liquidity: parseFloat(e.liquidity || "0"),
    volume: parseFloat(e.volume || "0"),
    endDate: e.endDate?.toISOString?.() || String(e.endDate),
    slug: e.slug || "",
    eventSlug: e.eventSlug || "",
    eventTitle: "",
    tags: [],
    category: e.category || "other",
    tickSize: parseFloat(e.tickSize || "0.01"),
    minOrderSize: 5,
    negRisk: e.negRisk || false,
    hoursToResolution: e.hoursToResolution || 0,
  }));

  const results = await evaluateBatch(outcomes);
  console.log(`AI evaluated ${results.size} events`);

  // Save AI scores
  const scored = [];
  for (const e of rows) {
    const key = e.marketId + "_0";
    const result = results.get(key);
    if (result) {
      await db.execute(sql`
        UPDATE scanned_events 
        SET aiScore = ${result.score}, aiReasoning = ${result.reasoning}, status = 'evaluated'
        WHERE id = ${e.id}
      `);
      scored.push({ ...e, aiScore: result.score, aiReasoning: result.reasoning });
      console.log(`  [Score ${result.score}] ${e.question} - ${e.outcome} @ $${e.price}`);
      console.log(`    ${result.reasoning.slice(0, 120)}`);
    }
  }

  // Step 4: Place orders on events scoring >= 5
  console.log("\n=== Step 4: Place Orders ===");
  const buyable = scored.filter(e => e.aiScore >= 5).sort((a, b) => b.aiScore - a.aiScore);
  console.log(`${buyable.length} events scored >= 5 (buyable)`);

  if (buyable.length === 0) {
    // If nothing scored 5+, try the top 3 regardless
    console.log("No events scored 5+. Placing orders on top 3 by score anyway...");
    buyable.push(...scored.sort((a, b) => b.aiScore - a.aiScore).slice(0, 3));
  }

  let ordersPlaced = 0;
  let totalSpent = 0;

  for (const event of buyable.slice(0, 20)) {
    if (!event.tokenId) {
      console.log(`  SKIP ${event.question} - no tokenId`);
      continue;
    }

    // Smart bet sizing: score 5=$5, 6=$7, 7=$10, 8=$15, 9=$20, 10=$25
    const sizeMap = { 5: 5, 6: 7, 7: 10, 8: 15, 9: 20, 10: 25 };
    const betSize = sizeMap[Math.min(event.aiScore, 10)] || 5;
    const price = parseFloat(event.price);
    const shares = Math.floor(betSize / price);

    if (shares < 1) {
      console.log(`  SKIP ${event.question} - shares < 1`);
      continue;
    }

    // Get the actual tick size from the market
    const rawTickSize = event.tickSize || "0.01";
    const tickSize = String(rawTickSize);
    const tick = parseFloat(tickSize);
    
    // Round price up to nearest valid tick (must be >= tick)
    let validPrice = Math.max(tick, Math.round(price / tick) * tick);
    validPrice = parseFloat(validPrice.toFixed(4));
    
    // Recalculate shares based on valid price
    const adjustedShares = Math.floor(betSize / validPrice);
    
    if (adjustedShares < 1) {
      console.log(`  SKIP ${event.question} - shares < 1 after price adjustment`);
      continue;
    }

    console.log(`\n  Placing: ${event.question} - ${event.outcome}`);
    console.log(`    Original: $${price}, Adjusted: $${validPrice}, Shares: ${adjustedShares}, Cost: ~$${(adjustedShares * validPrice).toFixed(2)}, AI Score: ${event.aiScore}`);

    try {
      const result = await placeLimitOrder(
        event.tokenId,
        validPrice,
        adjustedShares,
        tickSize,
        event.negRisk || false,
      );

      if (result.success) {
        console.log(`    ✅ ORDER PLACED! ID: ${result.orderId}`);
        ordersPlaced++;
        totalSpent += adjustedShares * validPrice;

        // Record in DB
        await db.execute(sql`
          INSERT INTO orders (scannedEventId, marketId, tokenId, side, price, size, amountUsd, status, clobOrderId, createdAt, updatedAt)
          VALUES (${event.id}, ${event.marketId}, ${event.tokenId}, 'BUY', ${String(validPrice)}, ${String(adjustedShares)}, ${String(adjustedShares * validPrice)}, 'placed', ${result.orderId}, NOW(), NOW())
        `);
        await db.execute(sql`
          INSERT INTO positions (scannedEventId, marketId, tokenId, question, outcome, category, entryPrice, shares, costBasis, currentPrice, currentValue, pnl, pnlPercent, status, endDate, createdAt, updatedAt)
          VALUES (${event.id}, ${event.marketId}, ${event.tokenId}, ${event.question}, ${event.outcome}, ${event.category || 'other'}, ${String(validPrice)}, ${String(adjustedShares)}, ${String(adjustedShares * validPrice)}, ${String(validPrice)}, ${String(adjustedShares * validPrice)}, '0', '0', 'open', ${event.endDate}, NOW(), NOW())
        `);
        await db.execute(sql`UPDATE scanned_events SET status = 'ordered' WHERE id = ${event.id}`);
      } else {
        console.log(`    ❌ FAILED: ${result.errorMsg}`);
      }
    } catch (err) {
      console.log(`    ❌ ERROR: ${err.message}`);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Orders placed: ${ordersPlaced}`);
  console.log(`Total spent: ~$${totalSpent.toFixed(2)}`);
  console.log(`Events in DB: 3586`);
  
  // Log it
  await db.execute(sql`
    INSERT INTO scan_logs (action, details, cheapFound, newDiscovered, ordersPlaced, createdAt)
    VALUES ('autopilot_cycle', ${`First cycle: ${ordersPlaced} orders placed, $${totalSpent.toFixed(2)} spent`}, ${scored.length}, ${buyable.length}, ${ordersPlaced}, NOW())
  `);

  process.exit(0);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
