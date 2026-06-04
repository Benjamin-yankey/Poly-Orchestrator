// ShopNow — Cart microservice
// Owns the Redis store (database-per-service). In the "full" app the cart is
// PER-USER: the caller's identity comes from the JWT minted by the Products/core
// API (shared JWT_SECRET), and each user's cart is a Redis hash keyed by user id.
// Each hash field is a productId; its value is the JSON line item (with qty).
// This service still knows nothing about Postgres or the product schema — the
// frontend passes the product snapshot (name/price/icon) when adding to cart.

const express = require("express");
const { createClient } = require("redis");
const jwt = require("jsonwebtoken");

const app = express();
app.disable("x-powered-by");
app.use(express.json());
const PORT = process.env.PORT || 5002;

const REDIS_HOST = process.env.REDIS_HOST || "redis";
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const JWT_SECRET = process.env.JWT_SECRET || "shopnow_dev_secret_change_me";

const who = () => process.env.HOSTNAME || "unknown";
const cartKey = (userId) => `shopnow:cart:${userId}`;
// Wishlist + save-for-later are per-user item collections — the same Redis-hash
// shape as the cart (field = productId, value = JSON line item), so a buyer can
// keep things for later without them counting toward the cart total. Each "shelf"
// is keyed by kind so one helper serves both.
const shelfKey = (kind, userId) => `shopnow:${kind}:${userId}`;

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

// Require a valid Bearer token; attach req.user (so carts are per-account).
function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "authentication required" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "invalid or expired token" });
  }
}

// Read the full cart for a user and compute count + subtotal.
async function cartState(userId) {
  const map = await redisClient.hGetAll(cartKey(userId));
  const items = Object.values(map)
    .map((v) => JSON.parse(v))
    .sort((a, b) => a.productId - b.productId);
  const count = items.reduce((s, it) => s + it.qty, 0);
  const subtotal = items.reduce((s, it) => s + Number(it.price) * it.qty, 0);
  return { servedBy: who(), items, count, subtotal: Number(subtotal.toFixed(2)) };
}

// Read a shelf (wishlist / saved-for-later) for a user. Unlike the cart there is
// no notion of a "total" the customer pays now, but we still expose count.
async function shelfState(kind, userId) {
  const map = await redisClient.hGetAll(shelfKey(kind, userId));
  const items = Object.values(map)
    .map((v) => JSON.parse(v))
    .sort((a, b) => a.productId - b.productId);
  return { servedBy: who(), items, count: items.length };
}

app.get("/health", (_req, res) => res.json({ status: "ok", service: "cart" }));

// Page-visit counter (global, no auth) — kept from the original demo.
app.get("/api/visits", async (_req, res) => {
  try {
    const visits = await redisClient.incr("shopnow:visits");
    res.json({ servedBy: who(), visits });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Current cart for the authenticated user.
app.get("/api/cart", authRequired, async (req, res) => {
  try {
    res.json(await cartState(req.user.sub));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Add a product to the cart (increments qty if already present).
// Body: { productId, name, price, icon, qty? }
app.post("/api/cart", authRequired, async (req, res) => {
  try {
    const { productId, name, price, icon, qty } = req.body || {};
    if (productId == null || name == null || price == null) {
      return res.status(400).json({ error: "productId, name and price are required" });
    }
    const key = cartKey(req.user.sub);
    const field = String(productId);
    const existing = await redisClient.hGet(key, field);
    const current = existing ? JSON.parse(existing) : { productId, name, price, icon: icon || "📦", qty: 0 };
    current.qty += Number(qty) > 0 ? Number(qty) : 1;
    current.price = price; // keep latest price snapshot
    await redisClient.hSet(key, field, JSON.stringify(current));
    res.json(await cartState(req.user.sub));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Set an exact quantity for a line (qty <= 0 removes it). Body: { productId, qty }
app.put("/api/cart", authRequired, async (req, res) => {
  try {
    const { productId, qty } = req.body || {};
    if (productId == null) return res.status(400).json({ error: "productId is required" });
    const key = cartKey(req.user.sub);
    const field = String(productId);
    if (Number(qty) <= 0) {
      await redisClient.hDel(key, field);
    } else {
      const existing = await redisClient.hGet(key, field);
      if (!existing) return res.status(404).json({ error: "item not in cart" });
      const line = JSON.parse(existing);
      line.qty = Number(qty);
      await redisClient.hSet(key, field, JSON.stringify(line));
    }
    res.json(await cartState(req.user.sub));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Remove a whole line from the cart. Body: { productId }
app.post("/api/cart/remove", authRequired, async (req, res) => {
  try {
    const { productId } = req.body || {};
    if (productId != null) await redisClient.hDel(cartKey(req.user.sub), String(productId));
    res.json(await cartState(req.user.sub));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Empty the whole cart (called after a successful checkout).
app.delete("/api/cart", authRequired, async (req, res) => {
  try {
    await redisClient.del(cartKey(req.user.sub));
    res.json(await cartState(req.user.sub));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Wishlist — items a shopper saved to buy later (no quantity, no total).
// ---------------------------------------------------------------------------
app.get("/api/wishlist", authRequired, async (req, res) => {
  try {
    res.json(await shelfState("wishlist", req.user.sub));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Add a product to the wishlist (idempotent — already-present items are kept).
// Body: { productId, name, price, icon }
app.post("/api/wishlist", authRequired, async (req, res) => {
  try {
    const { productId, name, price, icon } = req.body || {};
    if (productId == null || name == null || price == null) {
      return res.status(400).json({ error: "productId, name and price are required" });
    }
    await redisClient.hSet(
      shelfKey("wishlist", req.user.sub),
      String(productId),
      JSON.stringify({ productId, name, price, icon: icon || "📦" })
    );
    res.json(await shelfState("wishlist", req.user.sub));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Remove an item from the wishlist. Body: { productId }
app.post("/api/wishlist/remove", authRequired, async (req, res) => {
  try {
    const { productId } = req.body || {};
    if (productId != null) await redisClient.hDel(shelfKey("wishlist", req.user.sub), String(productId));
    res.json(await shelfState("wishlist", req.user.sub));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Save for later — cart lines parked off to the side (keep their quantity).
// ---------------------------------------------------------------------------
app.get("/api/saved", authRequired, async (req, res) => {
  try {
    res.json(await shelfState("saved", req.user.sub));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Park an item for later. Body: { productId, name, price, icon, qty }
app.post("/api/saved", authRequired, async (req, res) => {
  try {
    const { productId, name, price, icon, qty } = req.body || {};
    if (productId == null || name == null || price == null) {
      return res.status(400).json({ error: "productId, name and price are required" });
    }
    await redisClient.hSet(
      shelfKey("saved", req.user.sub),
      String(productId),
      JSON.stringify({ productId, name, price, icon: icon || "📦", qty: Number(qty) > 0 ? Number(qty) : 1 })
    );
    res.json(await shelfState("saved", req.user.sub));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Remove a parked item. Body: { productId }
app.post("/api/saved/remove", authRequired, async (req, res) => {
  try {
    const { productId } = req.body || {};
    if (productId != null) await redisClient.hDel(shelfKey("saved", req.user.sub), String(productId));
    res.json(await shelfState("saved", req.user.sub));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Cart service listening on :${PORT}`));
