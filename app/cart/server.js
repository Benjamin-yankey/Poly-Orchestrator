// ShopNow — Cart microservice
// Owns the Redis store (database-per-service). Handles the shopping cart and a
// page-visit counter. It knows nothing about Postgres or the products schema.

const express = require("express");
const { createClient } = require("redis");

const app = express();
app.disable("x-powered-by");
app.use(express.json());
const PORT = process.env.PORT || 5002;

const REDIS_HOST = process.env.REDIS_HOST || "redis";
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const CART_KEY = "shopnow:cart";

let redisClient;
(async () => {
  redisClient = createClient({ url: `redis://${REDIS_HOST}:${REDIS_PORT}` });
  redisClient.on("error", (err) => console.error("Redis error:", err.message));
  try {
    await redisClient.connect();
    console.log(`Connected to Redis at ${REDIS_HOST}:${REDIS_PORT}`);
  } catch (e) {
    console.error("Could not connect to Redis:", e.message);
  }
})();

const who = () => process.env.HOSTNAME || "unknown";

// Helper: return the full cart state in one shape.
async function cartState() {
  const items = await redisClient.lRange(CART_KEY, 0, -1);
  return { servedBy: who(), items, count: items.length };
}

app.get("/health", (_req, res) => res.json({ status: "ok", service: "cart" }));

// Page-visit counter.
app.get("/api/visits", async (_req, res) => {
  try {
    const visits = await redisClient.incr("shopnow:visits");
    res.json({ servedBy: who(), visits });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Current cart contents (full item list + count).
app.get("/api/cart", async (_req, res) => {
  try {
    res.json(await cartState());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Add an item to the cart.
app.post("/api/cart", async (req, res) => {
  try {
    const item = (req.body && req.body.item) || "item";
    await redisClient.rPush(CART_KEY, String(item));
    res.json(await cartState());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Remove a single occurrence of an item from the cart.
app.post("/api/cart/remove", async (req, res) => {
  try {
    const item = req.body && req.body.item;
    if (item) await redisClient.lRem(CART_KEY, 1, String(item)); // remove first match
    res.json(await cartState());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Empty the whole cart.
app.delete("/api/cart", async (_req, res) => {
  try {
    await redisClient.del(CART_KEY);
    res.json(await cartState());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Cart service listening on :${PORT}`));
