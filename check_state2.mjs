import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check columns
const [cols] = await conn.execute("DESCRIBE positions");
console.log('Positions columns:', cols.map(c => c.Field).join(', '));

// Open positions
const [open] = await conn.execute("SELECT COUNT(*) as cnt, SUM(entry_price * shares) as total FROM positions WHERE status='open'");
console.log('\nOpen positions:', open[0].cnt, '| Total deployed:', open[0].total);

// Resolved positions
const [resolved] = await conn.execute("SELECT COUNT(*) as cnt, SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins, SUM(CASE WHEN pnl <= 0 THEN 1 ELSE 0 END) as losses, SUM(pnl) as total_pnl FROM positions WHERE status='resolved'");
console.log('Resolved:', resolved[0].cnt, '| Wins:', resolved[0].wins, '| Losses:', resolved[0].losses, '| Total P&L:', resolved[0].total_pnl);

// Sold/closed positions
const [sold] = await conn.execute("SELECT COUNT(*) as cnt FROM positions WHERE status IN ('sold','closed')");
console.log('Sold/Closed:', sold[0].cnt);

// Bot config
const [config] = await conn.execute("SELECT config_key, config_value FROM bot_config WHERE config_key IN ('botEnabled','dailyBudget','maxCapital','autopilotEnabled','cycleIntervalMinutes')");
console.log('\nBot Config:');
config.forEach(r => console.log(`  ${r.config_key}: ${r.config_value}`));

// Daily spend today (EST)
const [spend] = await conn.execute(`
  SELECT COALESCE(SUM(total_cost), 0) as spent 
  FROM orders 
  WHERE status NOT IN ('failed','cancelled')
  AND DATE(CONVERT_TZ(created_at, '+00:00', '-04:00')) = DATE(CONVERT_TZ(NOW(), '+00:00', '-04:00'))
`);
console.log('\nDaily spend (EST today):', spend[0].spent);

// Recent orders
const [recent] = await conn.execute("SELECT id, status, total_cost, clob_order_id, created_at FROM orders ORDER BY id DESC LIMIT 5");
console.log('\nRecent 5 orders:');
recent.forEach(r => console.log(`  #${r.id}: ${r.status} $${r.total_cost} clob=${r.clob_order_id} ${r.created_at}`));

await conn.end();
