import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { sdk } from "./sdk";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./cookies";
import * as db from "../db";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // Simple password login for standalone deployment
  app.post("/api/password-login", async (req, res) => {
    try {
      const { password } = req.body;
      const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Mendy5271";
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: "Invalid password" });
      }
      // Create or find the owner user
      const ownerOpenId = process.env.OWNER_OPEN_ID || "standalone-owner";
      const ownerName = process.env.OWNER_NAME || "Owner";
      await db.upsertUser({
        openId: ownerOpenId,
        name: ownerName,
        role: "admin",
        lastSignedIn: new Date(),
      });
      // Create session JWT
      const token = await sdk.createSessionToken(ownerOpenId, { name: ownerName });
      res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: false,
        maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
      });
      return res.json({ success: true });
    } catch (err: any) {
      console.error("[PasswordLogin] Error:", err.message);
      return res.status(500).json({ error: "Login failed" });
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  // Auto-initialize CLOB client and proxy after server starts
  // This runs in the background so it doesn't block server startup
  setTimeout(async () => {
    try {
      const { initializeClobClient, getClobStatus } = await import("../services/clobTrader");
      const { startAutopilot } = await import("../services/autopilot");
      const { getDb } = await import("../db");
      
      // Check if wallet is configured
      const pk = process.env.POLYGON_PRIVATE_KEY;
      if (pk) {
        console.log("[Boot] Wallet detected, initializing CLOB client...");
        const result = await initializeClobClient();
        if (result.success) {
          console.log("[Boot] CLOB client initialized successfully");
        } else {
          console.warn("[Boot] CLOB init failed:", result.error);
        }
      }

      // Check if autopilot should auto-start
      const db = await getDb();
      if (db) {
        const { getAllConfig } = await import("../db");
        const configRows = await getAllConfig();
        const configMap = new Map(configRows.map((c: any) => [c.key, c.value]));
        if (configMap.get("autopilotEnabled") === "true" && configMap.get("botEnabled") === "true") {
          const interval = parseFloat(configMap.get("autopilotInterval") || "2");
          console.log(`[Boot] Auto-starting autopilot with ${interval}h interval...`);
          await startAutopilot(interval);
        }
      }
    } catch (err: any) {
      console.warn("[Boot] Auto-init error (non-fatal):", err.message);
    }
  }, 3000);
}

startServer().catch(console.error);
