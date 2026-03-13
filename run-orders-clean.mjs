/**
 * Clean order placement script - suppresses heartbeat noise
 * Finds AI-evaluated events and places real orders
 */
import { getDb } from './server/db.ts';
import { sql } from 'drizzle-orm';
import { initializeClobClient, placeLimitOrder, stopHeartbeat } from './server/services/clobTrader.ts';

// Suppress the CLOB client's noisy error logging for heartbeats
const origConsoleError = console.error;
const origConsoleWarn = console.warn;
console.error = (...args) => {
  const msg = args[0]?.toString() || '';
  if (msg.includes('[CLOB Client]') || msg.includes('heartbeat') || msg.includes('Heartbeat')) return;
  origConsoleError(...args);
};
console.warn = (...args) => {
  const msg = args[0]?.toString() || '';
  if (msg.includes('heartbeat') || msg.includes('Heartbeat')) return;
  origConsoleWarn(...args);
};

// Also suppress the CLOB client's internal console.log for circular JSON
const origLog = console.log;
console.log = (...args) => {
  const msg = args[0]?.toString() || '';
  if (msg.includes('[CLOB Client]') && msg.length > 500) return; // suppress circular JSON dumps
  origLog(...args);
};

async function run() {
  console.log('=== Polymarket Bot - Live Order Placement ===\n');
  
  // Step 1: Initialize CLOB
  console.log('Step 1: Initializing CLOB client...');
  const initResult = await initializeClobClient();
  if (!initResult.success) {
    console.error('CLOB init failed:', initResult.error);
    process.exit(1);
  }
  console.log('CLOB client initialized!\n');
  
  // Step 2: Get events that need AI evaluation
  const db = await getDb();
  
  // First check if we have any AI-scored events ready to buy
  const scored = await db.execute(sql`
    SELECT id, marketId, conditionId, tokenId, question, outcome, price, liquidity, volume, 
           endDate, category, tags, tickSize, negRisk, hoursToResolution, slug, eventSlug, aiScore, aiReasoning
    FROM scanned_events 
    WHERE aiScore >= 5
      AND status = 'evaluated'
      AND CAST(price AS DECIMAL(10,6)) >= 0.005
      AND CAST(price AS DECIMAL(10,6)) <= 0.03
    ORDER BY aiScore DESC, CAST(liquidity AS DECIMAL(20,2)) DESC
    LIMIT 20
  `);
  
  let events = scored[0];
  console.log(`Found ${events.length} AI-scored events ready to buy\n`);
  
  // If no scored events, evaluate some first
  if (events.length === 0) {
    console.log('No scored events. Running AI evaluation on top candidates...\n');
    
    const { evaluateBatch } = await import('./server/services/aiEvaluator.ts');
    
    const unevaluated = await db.execute(sql`
      SELECT id, marketId, conditionId, tokenId, question, outcome, price, liquidity, volume, 
             endDate, category, tags, tickSize, negRisk, hoursToResolution, slug, eventSlug
      FROM scanned_events 
      WHERE aiScore IS NULL 
        AND status = 'discovered'
        AND CAST(price AS DECIMAL(10,6)) >= 0.005
        AND CAST(price AS DECIMAL(10,6)) <= 0.03
        AND CAST(liquidity AS DECIMAL(20,2)) >= 1000
      ORDER BY CAST(liquidity AS DECIMAL(20,2)) DESC
      LIMIT 10
    `);
    
    if (unevaluated[0].length === 0) {
      console.log('No unevaluated events found. Run a scan first.');
      stopHeartbeat();
      process.exit(0);
    }
    
    console.log(`Evaluating ${unevaluated[0].length} events with AI...\n`);
    
    // Convert DB rows to ParsedCheapOutcome format for evaluateBatch
    const outcomes = unevaluated[0].map(e => ({
      conditionId: e.conditionId,
      question: e.question,
      outcome: e.outcome,
      price: parseFloat(e.price),
      liquidity: parseFloat(e.liquidity || '0'),
      volume: parseFloat(e.volume || '0'),
      endDate: e.endDate,
      category: e.category || 'other',
      tags: e.tags || '',
      hoursToResolution: e.hoursToResolution || 0,
    }));
    
    const aiResults = await evaluateBatch(outcomes);
    
    // Merge AI scores back into events
    const evaluated = unevaluated[0].map(e => {
      const result = aiResults.get(e.conditionId);
      return {
        ...e,
        aiScore: result?.score || 0,
        aiReasoning: result?.reasoning || '',
      };
    });
    
    // Save scores to DB
    for (const ev of evaluated) {
      if (ev.aiScore !== undefined) {
        await db.execute(sql`
          UPDATE scanned_events 
          SET aiScore = ${ev.aiScore}, aiReasoning = ${ev.aiReasoning || ''} 
          WHERE id = ${ev.id}
        `);
      }
    }
    
    events = evaluated.filter(e => (e.aiScore || 0) >= 5);
    console.log(`\n${events.length} events scored >= 5 (buyable)\n`);
  }
  
  if (events.length === 0) {
    console.log('No events passed AI evaluation. Try again later.');
    stopHeartbeat();
    process.exit(0);
  }
  
  // Step 3: Place orders
  console.log('=== Placing Orders ===\n');
  let ordersPlaced = 0;
  let totalSpent = 0;
  
  for (const event of events) {
    const price = parseFloat(event.price);
    const score = event.aiScore || 5;
    
    // Smart bet sizing: $5 for score 5-6, $10 for 7-8, $15 for 9, $25 for 10
    let betSize = 5;
    if (score >= 10) betSize = 25;
    else if (score >= 9) betSize = 15;
    else if (score >= 7) betSize = 10;
    
    const rawTickSize = event.tickSize || "0.01";
    const tick = parseFloat(rawTickSize);
    
    // Round price to valid tick
    let validPrice = Math.max(tick, Math.round(price / tick) * tick);
    validPrice = parseFloat(validPrice.toFixed(4));
    
    // Calculate shares
    const shares = Math.floor(betSize / validPrice);
    if (shares < 1) {
      console.log(`SKIP: ${event.question?.slice(0, 60)} - shares < 1`);
      continue;
    }
    
    const cost = shares * validPrice;
    console.log(`Placing: ${event.question?.slice(0, 70)}`);
    console.log(`  Score: ${score} | Price: $${validPrice} | Shares: ${shares} | Cost: $${cost.toFixed(2)} | Payout: $${shares.toFixed(2)}`);
    
    try {
      const result = await placeLimitOrder(
        event.tokenId,
        validPrice,
        shares,
        rawTickSize,
        event.negRisk === 1 || event.negRisk === true,
      );
      
      if (result.success) {
        console.log(`  ✅ ORDER PLACED! ID: ${result.orderId}`);
        ordersPlaced++;
        totalSpent += cost;
        
        // Record in DB
        await db.execute(sql`
          INSERT INTO orders (scannedEventId, marketId, tokenId, side, price, size, amountUsd, status, orderId, createdAt, updatedAt)
          VALUES (${event.id}, ${event.marketId}, ${event.tokenId}, 'BUY', ${String(validPrice)}, ${String(shares)}, ${String(cost)}, 'placed', ${result.orderId}, NOW(), NOW())
        `);
        await db.execute(sql`
          INSERT INTO positions (scannedEventId, marketId, tokenId, question, outcome, category, entryPrice, shares, costBasis, currentPrice, currentValue, pnl, pnlPercent, status, endDate, createdAt, updatedAt)
          VALUES (${event.id}, ${event.marketId}, ${event.tokenId}, ${event.question}, ${event.outcome}, ${event.category || 'other'}, ${String(validPrice)}, ${String(shares)}, ${String(cost)}, ${String(validPrice)}, ${String(cost)}, '0', '0', 'open', ${event.endDate}, NOW(), NOW())
        `);
        await db.execute(sql`UPDATE scanned_events SET status = 'ordered' WHERE id = ${event.id}`);
      } else {
        console.log(`  ❌ FAILED: ${result.errorMsg}`);
      }
    } catch (err) {
      console.log(`  ❌ ERROR: ${err.message}`);
    }
    
    // Small delay between orders
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log(`\n=== SUMMARY ===`);
  console.log(`Orders placed: ${ordersPlaced}`);
  console.log(`Total spent: ~$${totalSpent.toFixed(2)}`);
  console.log(`Potential payout per winner: varies by price`);
  
  // Clean up
  stopHeartbeat();
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  stopHeartbeat();
  process.exit(1);
});
