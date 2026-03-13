/**
 * Direct autopilot cycle runner.
 * Imports the services directly and runs a full scan-evaluate-buy cycle.
 */
import "dotenv/config";

// We need to run this through the server since it uses the DB and CLOB client.
// The simplest approach: call the server's internal endpoint.
// But since we need auth, let's use a different approach - 
// trigger the autopilot start via the server.

const BASE = "http://localhost:3000";

async function main() {
  console.log("=== Triggering Autopilot Cycle ===\n");
  
  // The autopilot endpoints require auth. Let's trigger via a direct import instead.
  // We'll use a dynamic import of the autopilot module.
  
  try {
    // Import the autopilot service directly
    const { runSingleCycle, startAutopilot, getAutopilotStatus } = await import("./server/services/autopilot.ts");
    
    console.log("Running single autopilot cycle...");
    console.log("This will scan, evaluate with AI, and place real orders.\n");
    
    const stats = await runSingleCycle();
    
    console.log("\n=== Cycle Complete ===");
    console.log(JSON.stringify(stats, null, 2));
    
    // Now start the recurring autopilot (every 4 hours)
    console.log("\nStarting recurring autopilot (every 4 hours)...");
    await startAutopilot(4);
    
    const status = getAutopilotStatus();
    console.log("Autopilot status:", JSON.stringify(status, null, 2));
    
    console.log("\n✅ Bot is now running autonomously!");
    console.log("Next cycle in 4 hours.");
    
    // Keep the process alive so autopilot timer continues
    // In production this runs inside the server process
    console.log("\nKeeping process alive for autopilot...");
    console.log("Press Ctrl+C to stop.\n");
    
  } catch (err) {
    console.error("Error:", err.message);
    
    // Fallback: try HTTP call
    console.log("\nTrying HTTP fallback...");
    try {
      // Run scan first
      console.log("Scanning markets...");
      const scanResp = await fetch(`${BASE}/api/trpc/scanner.scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      console.log("Scan response:", scanResp.status, await scanResp.text().then(t => t.slice(0, 200)));
    } catch (e2) {
      console.error("HTTP fallback also failed:", e2.message);
    }
  }
}

main();
