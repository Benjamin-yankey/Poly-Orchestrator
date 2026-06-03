// ShopNow — Products / Core API service
// Owns Postgres (database-per-service). In the "full" app this single service is
// the system of record for three resources that all live in the relational DB:
//   • the product catalog  (public read, admin write)
//   • user accounts + auth (JWT, bcrypt-hashed passwords)
//   • orders + order_items (checkout, with a MOCK payment gateway)
// It still knows nothing about Redis, the cart's internals, or the frontend — the
// cart lives in its own service. Keeping all relational data here preserves the
// "3 services, database-per-service" shape the ECS-vs-EKS benchmark relies on.

const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const { signToken, authRequired, adminRequired, managementRead, ROLES } = require("./auth");

const app = express();
app.disable("x-powered-by");
// Listings carry a user-uploaded photo as a base64 data URL, so the JSON body
// can be a few MB. Raise the limit well above express's 100kb default.
app.use(express.json({ limit: "8mb" }));
const PORT = process.env.PORT || 5001;

const pool = new Pool({
  host: process.env.PG_HOST || "postgres",
  port: process.env.PG_PORT || 5432,
  user: process.env.PG_USER || "shopnow",
  password: process.env.PG_PASSWORD || "shopnow_pass",
  database: process.env.PG_DATABASE || "shopnow",
});

const who = () => process.env.HOSTNAME || "unknown";
const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  created_at: u.created_at,
});

// Product photos and listing photos are both uploaded as base64 data URLs.
// Validate the prefix so we never persist arbitrary strings as "images".
const isDataImage = (s) => /^data:image\/(png|jpe?g|webp|gif);base64,/.test(s);

// Order fulfilment lifecycle. "paid" is where every order starts (the mock
// gateway charged successfully); admins move it forward, or to a terminal
// cancelled/refunded state.
const ORDER_STATUSES = ["paid", "processing", "shipped", "delivered", "cancelled", "refunded"];

// Append an entry to the audit trail. Best-effort: a logging failure must never
// break the action that triggered it, so we swallow errors (and log them to the
// container's stdout). `actor` is either an authenticated req.user or a literal
// { id, email } (used by the login route, which has no req.user yet).
async function audit(actor, action, entity = "", detail = "") {
  try {
    const id = actor?.sub ?? actor?.id ?? null;
    const email = actor?.email ?? "";
    await pool.query(
      `INSERT INTO audit_log (actor_id, actor_email, action, entity, detail)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, email, action, entity, detail]
    );
  } catch (e) {
    console.error("audit log failed:", e.message);
  }
}

// ---------------------------------------------------------------------------
// Schema + seed (idempotent, retried while Postgres boots)
// ---------------------------------------------------------------------------
async function initDb() {
  const ddl = `
    CREATE TABLE IF NOT EXISTS products (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      price       NUMERIC(10,2) NOT NULL,
      category    TEXT NOT NULL DEFAULT 'General',
      icon        TEXT NOT NULL DEFAULT '📦',
      image       TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      stock       INTEGER NOT NULL DEFAULT 100
    );
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name          TEXT NOT NULL DEFAULT '',
      role          TEXT NOT NULL DEFAULT 'customer',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS orders (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      total       NUMERIC(10,2) NOT NULL,
      status      TEXT NOT NULL DEFAULT 'paid',
      payment_ref TEXT NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id         SERIAL PRIMARY KEY,
      order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER,
      name       TEXT NOT NULL,
      price      NUMERIC(10,2) NOT NULL,
      qty        INTEGER NOT NULL
    );
    -- User-posted marketplace listings. Unlike the catalog (admin-owned, bought
    -- via the cart), these are classifieds: any user posts an item and buyers
    -- CALL the seller's phone to arrange the purchase. No cart, no checkout.
    CREATE TABLE IF NOT EXISTS listings (
      id          SERIAL PRIMARY KEY,
      seller_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      price       NUMERIC(10,2) NOT NULL,
      category    TEXT NOT NULL DEFAULT 'General',
      image       TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      phone       TEXT NOT NULL,
      location    TEXT NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Sellers now upload a real photo (stored as a base64 data URL) instead of
    -- picking an emoji. Add the column for databases created before this change.
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS image TEXT NOT NULL DEFAULT '';
    -- The catalog gained real product photos (base64 data URL); the emoji icon is
    -- now just a fallback. Add the column for databases created before this change.
    ALTER TABLE products ADD COLUMN IF NOT EXISTS image TEXT NOT NULL DEFAULT '';
    -- Orders now carry a fulfilment lifecycle (paid -> processing -> shipped ->
    -- delivered, plus cancelled/refunded) and, once shipped, a carrier + tracking
    -- number. Add the columns for databases created before this change.
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier  TEXT NOT NULL DEFAULT '';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking TEXT NOT NULL DEFAULT '';
    -- Accounts can be disabled (kept for history) instead of deleted. A disabled
    -- account cannot log in. Add the column for databases created before this.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
    -- Audit trail: every admin mutation and every login is appended here so the
    -- Security tab can show who did what, when.
    CREATE TABLE IF NOT EXISTS audit_log (
      id          SERIAL PRIMARY KEY,
      actor_id    INTEGER,
      actor_email TEXT NOT NULL DEFAULT '',
      action      TEXT NOT NULL,
      entity      TEXT NOT NULL DEFAULT '',
      detail      TEXT NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Products can carry a percentage discount (0 = full price). The storefront
    -- shows the struck-through original next to the sale price.
    ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_pct INTEGER NOT NULL DEFAULT 0;
    -- Marketing: promo codes applied at checkout for a percentage off the order.
    CREATE TABLE IF NOT EXISTS coupons (
      id          SERIAL PRIMARY KEY,
      code        TEXT UNIQUE NOT NULL,
      percent_off INTEGER NOT NULL,
      active      BOOLEAN NOT NULL DEFAULT true,
      expires_at  TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Content management: simple key/value store for editable site content
    -- (homepage banner, store name). Read publicly, written by admins.
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );`;

  const seedProducts = `
    INSERT INTO products (name, price, category, icon, description, stock)
    SELECT * FROM (VALUES
      ('Wireless Mouse', 24.99, 'Accessories', '🖱️', 'Ergonomic 2.4GHz wireless mouse with silent clicks and 18-month battery life.', 120),
      ('Mechanical Keyboard', 89.50, 'Accessories', '⌨️', 'Hot-swappable mechanical keyboard with tactile brown switches and RGB backlight.', 60),
      ('27" 4K Monitor', 219.00, 'Displays', '🖥️', '27-inch 4K IPS display with HDR10, 99% sRGB and a height-adjustable stand.', 35),
      ('USB-C Hub', 39.95, 'Accessories', '🔌', '7-in-1 USB-C hub: HDMI 4K, 100W passthrough, SD reader and 3x USB-A.', 200),
      ('Noise-Cancelling Headphones', 149.00, 'Audio', '🎧', 'Over-ear ANC headphones with 30h battery and multipoint Bluetooth.', 80),
      ('1080p Webcam', 59.99, 'Accessories', '📷', 'Full-HD webcam with auto-light correction and a privacy shutter.', 95),
      ('Aluminium Laptop Stand', 34.50, 'Office', '💻', 'Adjustable aluminium laptop riser that improves airflow and posture.', 150),
      ('LED Desk Lamp', 27.00, 'Office', '💡', 'Dimmable LED desk lamp with 5 colour temperatures and a USB charging port.', 140),
      ('Wireless Charging Pad', 19.99, 'Accessories', '🔋', '15W Qi fast-charging pad with anti-slip surface and foreign-object detection.', 220),
      ('4K Action Camera', 129.00, 'Audio', '🎥', 'Waterproof 4K60 action camera with electronic stabilisation and touch screen.', 40),
      ('Ergonomic Office Chair', 189.00, 'Office', '🪑', 'Breathable mesh office chair with lumbar support and 4D armrests.', 25),
      ('Portable SSD 1TB', 99.00, 'Displays', '💾', 'Pocket-size 1TB NVMe SSD, up to 1050MB/s over USB-C.', 70)
    ) AS v(name, price, category, icon, description, stock)
    WHERE NOT EXISTS (SELECT 1 FROM products);`;

  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      await pool.query(ddl);
      await pool.query(seedProducts);
      await seedUsers();
      await seedSettings();
      console.log("Postgres ready; catalog, users and orders schema seeded.");
      return;
    } catch (e) {
      console.log(`DB not ready (attempt ${attempt}/15): ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  console.error("Gave up initialising Postgres.");
}

// Seed a default admin + demo customer so the app is usable out of the box.
async function seedUsers() {
  const seeds = [
    { email: "admin@shopnow.local", password: "admin123", name: "Store Admin", role: "admin" },
    { email: "staff@shopnow.local", password: "staff123", name: "Staffing Team", role: "staffing_team" },
    { email: "employee@shopnow.local", password: "employee123", name: "Provisioned Employee", role: "employee" },
    { email: "demo@shopnow.local", password: "demo123", name: "Demo Customer", role: "customer" },
  ];
  for (const u of seeds) {
    const hash = await bcrypt.hash(u.password, 10);
    await pool.query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING`,
      [u.email, hash, u.name, u.role]
    );
  }
}

// Seed editable site content so the storefront has sensible defaults out of the
// box. Existing values are preserved (admins may have customised them).
async function seedSettings() {
  const defaults = [
    ["store_name", "ShopNow"],
    ["banner", "Welcome to ShopNow — free shipping on orders over $100!"],
  ];
  for (const [key, value] of defaults) {
    await pool.query(
      "INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING",
      [key, value]
    );
  }
}
initDb();

app.get("/health", (_req, res) => res.json({ status: "ok", service: "products" }));

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

// List products with optional ?search= and ?category= filters.
app.get("/api/products", async (req, res) => {
  try {
    const { search, category } = req.query;
    const clauses = [];
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      clauses.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length})`);
    }
    if (category && category !== "All") {
      params.push(category);
      clauses.push(`category = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT id, name, price, category, icon, image, description, stock, discount_pct
         FROM products ${where} ORDER BY id`,
      params
    );
    res.json({ servedBy: who(), products: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Distinct category list (for the storefront filter bar).
app.get("/api/categories", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT DISTINCT category FROM products ORDER BY category");
    res.json({ categories: rows.map((r) => r.category) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Single product detail.
app.get("/api/products/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, price, category, icon, image, description, stock, discount_pct FROM products WHERE id=$1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "product not found" });
    res.json({ product: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Admin catalog management -------------------------------------------------
app.post("/api/products", authRequired, adminRequired, async (req, res) => {
  try {
    const { name, price, category, icon, image, description, stock, discount_pct } = req.body || {};
    if (!name || price == null) return res.status(400).json({ error: "name and price are required" });
    if (image && !isDataImage(image)) {
      return res.status(400).json({ error: "image must be a base64-encoded data URL" });
    }
    const disc = Math.max(0, Math.min(90, Number(discount_pct) || 0));
    const { rows } = await pool.query(
      `INSERT INTO products (name, price, category, icon, image, description, stock, discount_pct)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, name, price, category, icon, image, description, stock, discount_pct`,
      [name, price, category || "General", icon || "📦", image || "", description || "", stock ?? 100, disc]
    );
    audit(req.user, "product.create", "product:" + rows[0].id, rows[0].name);
    res.status(201).json({ product: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/products/:id", authRequired, adminRequired, async (req, res) => {
  try {
    const { name, price, category, icon, image, description, stock, discount_pct } = req.body || {};
    if (image && !isDataImage(image)) {
      return res.status(400).json({ error: "image must be a base64-encoded data URL" });
    }
    // Clamp the discount when supplied; null leaves the existing value untouched.
    const disc =
      discount_pct == null ? null : Math.max(0, Math.min(90, Number(discount_pct) || 0));
    const { rows } = await pool.query(
      `UPDATE products SET
         name=COALESCE($2,name), price=COALESCE($3,price), category=COALESCE($4,category),
         icon=COALESCE($5,icon), image=COALESCE($6,image), description=COALESCE($7,description),
         stock=COALESCE($8,stock), discount_pct=COALESCE($9,discount_pct)
       WHERE id=$1
       RETURNING id, name, price, category, icon, image, description, stock, discount_pct`,
      [req.params.id, name, price, category, icon, image, description, stock, disc]
    );
    if (!rows.length) return res.status(404).json({ error: "product not found" });
    audit(req.user, "product.update", "product:" + rows[0].id, rows[0].name);
    res.json({ product: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/products/:id", authRequired, adminRequired, async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM products WHERE id=$1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "product not found" });
    audit(req.user, "product.delete", "product:" + req.params.id, "");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Marketplace listings (user-posted classifieds — buyers call the seller)
// ---------------------------------------------------------------------------

// Public: browse listings with optional ?search= and ?category= filters.
app.get("/api/listings", async (req, res) => {
  try {
    const { search, category } = req.query;
    const clauses = [];
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      clauses.push(`(l.title ILIKE $${params.length} OR l.description ILIKE $${params.length})`);
    }
    if (category && category !== "All") {
      params.push(category);
      clauses.push(`l.category = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT l.id, l.title, l.price, l.category, l.image, l.description,
              l.phone, l.location, l.created_at, l.seller_id, u.name AS seller_name
         FROM listings l JOIN users u ON u.id = l.seller_id
         ${where} ORDER BY l.id DESC`,
      params
    );
    res.json({ servedBy: who(), listings: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Distinct categories across listings (for the marketplace filter bar).
app.get("/api/listings/categories", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT DISTINCT category FROM listings ORDER BY category");
    res.json({ categories: rows.map((r) => r.category) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// The caller's own listings.
app.get("/api/listings/mine", authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, price, category, image, description, phone, location, created_at
         FROM listings WHERE seller_id=$1 ORDER BY id DESC`,
      [req.user.sub]
    );
    res.json({ listings: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Single listing detail (public).
app.get("/api/listings/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.id, l.title, l.price, l.category, l.image, l.description,
              l.phone, l.location, l.created_at, l.seller_id, u.name AS seller_name
         FROM listings l JOIN users u ON u.id = l.seller_id
        WHERE l.id=$1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "listing not found" });
    res.json({ listing: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Post a listing. Any authenticated user may sell; phone is how buyers reach them.
app.post("/api/listings", authRequired, async (req, res) => {
  try {
    const { title, price, category, image, description, phone, location } = req.body || {};
    if (!title || price == null || !phone) {
      return res.status(400).json({ error: "title, price and phone are required" });
    }
    if (Number(price) < 0 || Number.isNaN(Number(price))) {
      return res.status(400).json({ error: "price must be a non-negative number" });
    }
    // The image (optional) is a base64 data URL captured from the seller's upload.
    if (image && !isDataImage(image)) {
      return res.status(400).json({ error: "image must be a base64-encoded data URL" });
    }
    const { rows } = await pool.query(
      `INSERT INTO listings (seller_id, title, price, category, image, description, phone, location)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, title, price, category, image, description, phone, location, created_at, seller_id`,
      [
        req.user.sub,
        title,
        price,
        category || "General",
        image || "",
        description || "",
        phone,
        location || "",
      ]
    );
    res.status(201).json({ listing: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Remove a listing — only the seller who posted it, or an admin.
app.delete("/api/listings/:id", authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT seller_id FROM listings WHERE id=$1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "listing not found" });
    if (rows[0].seller_id !== req.user.sub && req.user.role !== "admin") {
      return res.status(403).json({ error: "forbidden" });
    }
    await pool.query("DELETE FROM listings WHERE id=$1", [req.params.id]);
    audit(req.user, "listing.delete", "listing:" + req.params.id, "");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email and password are required" });
    const hash = await bcrypt.hash(password, 10);
    let rows;
    try {
      ({ rows } = await pool.query(
        `INSERT INTO users (email, password_hash, name, role)
         VALUES ($1,$2,$3,'customer')
         RETURNING id, email, name, role, created_at`,
        [String(email).toLowerCase(), hash, name || ""]
      ));
    } catch (e) {
      if (e.code === "23505") return res.status(409).json({ error: "email already registered" });
      throw e;
    }
    const user = rows[0];
    res.status(201).json({ token: signToken(user), user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const { rows } = await pool.query("SELECT * FROM users WHERE email=$1", [
      String(email || "").toLowerCase(),
    ]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password || "", user.password_hash))) {
      return res.status(401).json({ error: "invalid email or password" });
    }
    if (user.active === false) {
      return res.status(403).json({ error: "this account has been disabled" });
    }
    audit(user, "auth.login", "user:" + user.id, user.email);
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Return the caller's profile (verifies the token is still valid).
app.get("/api/auth/me", authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, email, name, role, created_at FROM users WHERE id=$1",
      [req.user.sub]
    );
    if (!rows.length) return res.status(404).json({ error: "user not found" });
    res.json({ user: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update the caller's own profile: display name, and optionally the password
// (which requires the current password). Email and role are immutable here.
app.put("/api/auth/me", authRequired, async (req, res) => {
  try {
    const { name, currentPassword, newPassword } = req.body || {};

    if (newPassword != null && newPassword !== "") {
      if (String(newPassword).length < 6) {
        return res.status(400).json({ error: "new password must be at least 6 characters" });
      }
      const { rows } = await pool.query("SELECT password_hash FROM users WHERE id=$1", [req.user.sub]);
      if (!rows.length) return res.status(404).json({ error: "user not found" });
      if (!(await bcrypt.compare(currentPassword || "", rows[0].password_hash))) {
        return res.status(401).json({ error: "current password is incorrect" });
      }
      const hash = await bcrypt.hash(newPassword, 10);
      await pool.query("UPDATE users SET password_hash=$2 WHERE id=$1", [req.user.sub, hash]);
    }

    const { rows } = await pool.query(
      `UPDATE users SET name=COALESCE($2, name) WHERE id=$1
       RETURNING id, email, name, role, created_at`,
      [req.user.sub, name]
    );
    if (!rows.length) return res.status(404).json({ error: "user not found" });
    res.json({ user: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Orders + MOCK payment gateway
// ---------------------------------------------------------------------------

// Mock gateway: deterministic so it's testable. Any card whose number ends in
// "0000" is declined; everything else is approved. No external service, no keys.
// Look up a usable coupon by code: must exist, be active and not expired.
async function findValidCoupon(code) {
  if (!code) return null;
  const { rows } = await pool.query(
    `SELECT id, code, percent_off FROM coupons
      WHERE lower(code) = lower($1) AND active = true
        AND (expires_at IS NULL OR expires_at > now())`,
    [String(code).trim()]
  );
  return rows[0] || null;
}

function mockCharge(payment, amount) {
  const number = String(payment?.cardNumber || "").replace(/\s+/g, "");
  if (number.length < 12) return { ok: false, reason: "invalid card number" };
  if (number.endsWith("0000")) return { ok: false, reason: "card declined by issuer" };
  const ref = "MOCK-" + Date.now().toString(36).toUpperCase() + "-" + number.slice(-4);
  return { ok: true, ref, amount };
}

// Place an order. The frontend posts the cart contents + payment details; we
// validate, "charge" via the mock gateway, then persist the order atomically.
app.post("/api/orders", authRequired, async (req, res) => {
  const client = await pool.connect();
  try {
    const { items, payment, couponCode } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "cart is empty" });
    }
    let total = items.reduce((s, it) => s + Number(it.price) * Number(it.qty), 0);

    // Apply a promo code if one was supplied — validated server-side so the
    // client can't fake a discount.
    if (couponCode) {
      const coupon = await findValidCoupon(couponCode);
      if (!coupon) return res.status(400).json({ error: "invalid or expired coupon" });
      total = total * (1 - coupon.percent_off / 100);
    }

    const charge = mockCharge(payment, total);
    if (!charge.ok) return res.status(402).json({ error: `payment failed: ${charge.reason}` });

    await client.query("BEGIN");
    const { rows: orderRows } = await client.query(
      `INSERT INTO orders (user_id, total, status, payment_ref)
       VALUES ($1,$2,'paid',$3) RETURNING id, total, status, payment_ref, created_at`,
      [req.user.sub, total.toFixed(2), charge.ref]
    );
    const order = orderRows[0];
    for (const it of items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, name, price, qty)
         VALUES ($1,$2,$3,$4,$5)`,
        [order.id, it.productId || null, it.name, it.price, it.qty]
      );
      // Draw the purchased units down from the catalog stock (never below zero).
      // Marketplace items have no productId, so this only touches real products.
      if (it.productId) {
        await client.query(
          "UPDATE products SET stock = GREATEST(0, stock - $2) WHERE id = $1",
          [it.productId, Number(it.qty)]
        );
      }
    }
    await client.query("COMMIT");
    res.status(201).json({ order: { ...order, items } });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// The caller's order history.
app.get("/api/orders", authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, total, status, payment_ref, created_at
         FROM orders WHERE user_id=$1 ORDER BY id DESC`,
      [req.user.sub]
    );
    res.json({ orders: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// A single order with its line items (must belong to the caller, unless admin).
app.get("/api/orders/:id", authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM orders WHERE id=$1", [req.params.id]);
    const order = rows[0];
    if (!order) return res.status(404).json({ error: "order not found" });
    if (order.user_id !== req.user.sub && req.user.role !== "admin") {
      return res.status(403).json({ error: "forbidden" });
    }
    const { rows: items } = await pool.query(
      "SELECT product_id, name, price, qty FROM order_items WHERE order_id=$1 ORDER BY id",
      [order.id]
    );
    res.json({ order, items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Admin views --------------------------------------------------------------
app.get("/api/admin/orders", authRequired, managementRead, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.total, o.status, o.payment_ref, o.carrier, o.tracking, o.created_at,
              u.email AS customer_email, u.name AS customer_name
         FROM orders o JOIN users u ON u.id = o.user_id
       ORDER BY o.id DESC`
    );
    res.json({ orders: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Move an order through its fulfilment lifecycle (and record carrier/tracking
// when shipping). A status of "refunded" is how an admin issues a refund against
// the mock gateway — there's no external call, the order is just marked refunded.
app.put("/api/admin/orders/:id/status", authRequired, adminRequired, async (req, res) => {
  try {
    const { status, carrier, tracking } = req.body || {};
    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${ORDER_STATUSES.join(", ")}` });
    }
    const { rows } = await pool.query(
      `UPDATE orders SET
         status   = $2,
         carrier  = COALESCE($3, carrier),
         tracking = COALESCE($4, tracking)
       WHERE id = $1
       RETURNING id, total, status, payment_ref, carrier, tracking, created_at`,
      [Number(req.params.id), status, carrier ?? null, tracking ?? null]
    );
    if (!rows.length) return res.status(404).json({ error: "order not found" });
    audit(req.user, "order.status", "order:" + rows[0].id, status);
    res.json({ order: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Dashboard stats for the admin home. Returns headline counters plus a few
// breakdowns the dashboard charts render (revenue per day, stock health,
// listings per category, top-selling products).
app.get("/api/admin/stats", authRequired, managementRead, async (_req, res) => {
  try {
    const [
      { rows: p },
      { rows: o },
      { rows: u },
      { rows: l },
      { rows: roles },
      { rows: stockRows },
      { rows: revByDay },
      { rows: topProducts },
      { rows: ordersByStatus },
    ] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS n, COALESCE(SUM(stock),0)::int AS stock FROM products"),
      pool.query("SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0)::numeric(12,2) AS revenue FROM orders"),
      pool.query("SELECT COUNT(*)::int AS n FROM users"),
      pool.query("SELECT COUNT(*)::int AS n FROM listings"),
      pool.query("SELECT role, COUNT(*)::int AS n FROM users GROUP BY role"),
      pool.query(`SELECT
                    COUNT(*) FILTER (WHERE stock = 0)::int     AS out_of_stock,
                    COUNT(*) FILTER (WHERE stock > 0 AND stock <= 10)::int AS low_stock,
                    COUNT(*) FILTER (WHERE stock > 10)::int     AS healthy
                  FROM products`),
      pool.query(`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
                         COUNT(*)::int AS orders,
                         COALESCE(SUM(total),0)::numeric(12,2) AS revenue
                    FROM orders
                   WHERE created_at >= now() - interval '13 days'
                   GROUP BY day ORDER BY day`),
      pool.query(`SELECT name, SUM(qty)::int AS units, SUM(price * qty)::numeric(12,2) AS revenue
                    FROM order_items GROUP BY name ORDER BY units DESC LIMIT 5`),
      pool.query("SELECT status, COUNT(*)::int AS n FROM orders GROUP BY status"),
    ]);

    const roleMap = Object.fromEntries(roles.map((r) => [r.role, r.n]));
    // Counts for every known role (zero-filled), for the Roles tab.
    const roleCounts = Object.fromEntries(ROLES.map((r) => [r, roleMap[r] || 0]));
    res.json({
      products: p[0].n,
      orders: o[0].n,
      revenue: Number(o[0].revenue),
      users: u[0].n,
      listings: l[0].n,
      admins: roleMap.admin || 0,
      customers: roleMap.customer || 0,
      roleCounts,
      totalStock: p[0].stock,
      stockHealth: stockRows[0],
      revenueByDay: revByDay.map((r) => ({ ...r, revenue: Number(r.revenue) })),
      topProducts: topProducts.map((r) => ({ ...r, revenue: Number(r.revenue) })),
      ordersByStatus,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Admin user + role management ---------------------------------------------

// All users, with how many orders each has placed (for the Users table).
app.get("/api/admin/users", authRequired, managementRead, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.name, u.role, u.active, u.created_at,
              COUNT(o.id)::int AS orders,
              COALESCE(SUM(o.total),0)::numeric(12,2) AS spent
         FROM users u LEFT JOIN orders o ON o.user_id = u.id
        GROUP BY u.id ORDER BY u.id`
    );
    res.json({ users: rows.map((r) => ({ ...r, spent: Number(r.spent) })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin-provisioned account creation. Customers self-register (always 'customer');
// internal roles (admin, staffing_team, employee) can only be created here.
app.post("/api/admin/users", authRequired, adminRequired, async (req, res) => {
  try {
    const { email, password, name, role } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email and password are required" });
    if (String(password).length < 6) {
      return res.status(400).json({ error: "password must be at least 6 characters" });
    }
    if (role && !ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${ROLES.join(", ")}` });
    }
    const hash = await bcrypt.hash(password, 10);
    let rows;
    try {
      ({ rows } = await pool.query(
        `INSERT INTO users (email, password_hash, name, role)
         VALUES ($1,$2,$3,$4)
         RETURNING id, email, name, role, created_at`,
        [String(email).toLowerCase(), hash, name || "", role || "customer"]
      ));
    } catch (e) {
      if (e.code === "23505") return res.status(409).json({ error: "email already registered" });
      throw e;
    }
    audit(req.user, "user.create", "user:" + rows[0].id, `${rows[0].email} (${rows[0].role})`);
    res.status(201).json({ user: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Change a user's role. Only admins may do this (adminRequired). Guard against an
// admin demoting themselves and against removing the last remaining admin.
app.put("/api/admin/users/:id/role", authRequired, adminRequired, async (req, res) => {
  try {
    const { role } = req.body || {};
    if (!ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${ROLES.join(", ")}` });
    }
    const id = Number(req.params.id);
    if (id === req.user.sub && role !== "admin") {
      return res.status(400).json({ error: "you cannot remove your own admin access" });
    }
    if (role !== "admin") {
      const { rows: a } = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role='admin'");
      const { rows: cur } = await pool.query("SELECT role FROM users WHERE id=$1", [id]);
      if (cur[0]?.role === "admin" && a[0].n <= 1) {
        return res.status(400).json({ error: "cannot demote the last admin" });
      }
    }
    const { rows } = await pool.query(
      "UPDATE users SET role=$2 WHERE id=$1 RETURNING id, email, name, role, created_at",
      [id, role]
    );
    if (!rows.length) return res.status(404).json({ error: "user not found" });
    audit(req.user, "user.role", "user:" + rows[0].id, `${rows[0].email} → ${role}`);
    res.json({ user: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin password reset. Sets a new password for any account without needing the
// current one — for support ("reset my password") requests. The admin supplies
// the new password (min 6 chars); the user can change it later from their profile.
app.post("/api/admin/users/:id/reset-password", authRequired, adminRequired, async (req, res) => {
  try {
    const { newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: "new password must be at least 6 characters" });
    }
    const hash = await bcrypt.hash(String(newPassword), 10);
    const { rows } = await pool.query(
      "UPDATE users SET password_hash=$2 WHERE id=$1 RETURNING id, email, name, role",
      [Number(req.params.id), hash]
    );
    if (!rows.length) return res.status(404).json({ error: "user not found" });
    audit(req.user, "user.reset_password", "user:" + rows[0].id, rows[0].email);
    res.json({ ok: true, user: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Enable/disable an account. A disabled user keeps all their data (orders stay
// intact) but cannot log in. Guard against disabling yourself or the last admin.
app.put("/api/admin/users/:id/active", authRequired, adminRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const active = !!(req.body || {}).active;
    if (id === req.user.sub && !active) {
      return res.status(400).json({ error: "you cannot disable your own account" });
    }
    if (!active) {
      const { rows: cur } = await pool.query("SELECT role FROM users WHERE id=$1", [id]);
      if (!cur.length) return res.status(404).json({ error: "user not found" });
      if (cur[0].role === "admin") {
        const { rows: a } = await pool.query(
          "SELECT COUNT(*)::int AS n FROM users WHERE role='admin' AND active=true"
        );
        if (a[0].n <= 1) return res.status(400).json({ error: "cannot disable the last active admin" });
      }
    }
    const { rows } = await pool.query(
      "UPDATE users SET active=$2 WHERE id=$1 RETURNING id, email, name, role, active, created_at",
      [id, active]
    );
    if (!rows.length) return res.status(404).json({ error: "user not found" });
    audit(req.user, active ? "user.enable" : "user.disable", "user:" + id, rows[0].email);
    res.json({ user: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a user. Cannot delete yourself or the last admin. Users with orders are
// kept (orders reference them) — return a clear error instead of a FK crash.
app.delete("/api/admin/users/:id", authRequired, adminRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.sub) return res.status(400).json({ error: "you cannot delete your own account" });
    const { rows: cur } = await pool.query("SELECT role FROM users WHERE id=$1", [id]);
    if (!cur.length) return res.status(404).json({ error: "user not found" });
    if (cur[0].role === "admin") {
      const { rows: a } = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role='admin'");
      if (a[0].n <= 1) return res.status(400).json({ error: "cannot delete the last admin" });
    }
    const { rows: ord } = await pool.query("SELECT COUNT(*)::int AS n FROM orders WHERE user_id=$1", [id]);
    if (ord[0].n > 0) {
      return res.status(409).json({ error: "user has orders and cannot be deleted" });
    }
    await pool.query("DELETE FROM users WHERE id=$1", [id]);
    audit(req.user, "user.delete", "user:" + id, "");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Admin marketplace moderation ---------------------------------------------

// Every marketplace listing, with seller info, so an admin can moderate them.
// (Removal reuses the existing DELETE /api/listings/:id, which allows admins.)
app.get("/api/admin/listings", authRequired, managementRead, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.id, l.title, l.price, l.category, l.image, l.description,
              l.phone, l.location, l.created_at, l.seller_id,
              u.name AS seller_name, u.email AS seller_email
         FROM listings l JOIN users u ON u.id = l.seller_id
        ORDER BY l.id DESC`
    );
    res.json({ listings: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Security & monitoring ----------------------------------------------------

// Recent audit-trail entries (admin actions + logins) for the Security tab.
// Supports ?limit= (default 100, capped at 500).
app.get("/api/admin/audit", authRequired, managementRead, async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const { rows } = await pool.query(
      `SELECT id, actor_id, actor_email, action, entity, detail, created_at
         FROM audit_log ORDER BY id DESC LIMIT $1`,
      [limit]
    );
    res.json({ entries: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Marketing — coupons
// ---------------------------------------------------------------------------

// Validate a promo code (used at checkout). Returns the percent off if usable.
app.post("/api/coupons/validate", authRequired, async (req, res) => {
  try {
    const coupon = await findValidCoupon((req.body || {}).code);
    if (!coupon) return res.status(404).json({ error: "invalid or expired coupon" });
    res.json({ coupon });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin coupon management.
app.get("/api/admin/coupons", authRequired, managementRead, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, code, percent_off, active, expires_at, created_at FROM coupons ORDER BY id DESC"
    );
    res.json({ coupons: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/admin/coupons", authRequired, adminRequired, async (req, res) => {
  try {
    const { code, percent_off, expires_at } = req.body || {};
    const pct = Number(percent_off);
    if (!code || !String(code).trim()) return res.status(400).json({ error: "code is required" });
    if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
      return res.status(400).json({ error: "percent_off must be between 1 and 100" });
    }
    let rows;
    try {
      ({ rows } = await pool.query(
        `INSERT INTO coupons (code, percent_off, expires_at)
         VALUES ($1,$2,$3) RETURNING id, code, percent_off, active, expires_at, created_at`,
        [String(code).trim().toUpperCase(), Math.round(pct), expires_at || null]
      ));
    } catch (e) {
      if (e.code === "23505") return res.status(409).json({ error: "coupon code already exists" });
      throw e;
    }
    audit(req.user, "coupon.create", "coupon:" + rows[0].id, `${rows[0].code} (${rows[0].percent_off}%)`);
    res.status(201).json({ coupon: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Toggle active / edit a coupon's discount or expiry.
app.put("/api/admin/coupons/:id", authRequired, adminRequired, async (req, res) => {
  try {
    const { percent_off, active, expires_at } = req.body || {};
    const pct =
      percent_off == null ? null : Math.max(1, Math.min(100, Math.round(Number(percent_off))));
    const { rows } = await pool.query(
      `UPDATE coupons SET
         percent_off = COALESCE($2, percent_off),
         active      = COALESCE($3, active),
         expires_at  = COALESCE($4, expires_at)
       WHERE id = $1
       RETURNING id, code, percent_off, active, expires_at, created_at`,
      [Number(req.params.id), pct, active ?? null, expires_at ?? null]
    );
    if (!rows.length) return res.status(404).json({ error: "coupon not found" });
    audit(req.user, "coupon.update", "coupon:" + rows[0].id, rows[0].code);
    res.json({ coupon: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/admin/coupons/:id", authRequired, adminRequired, async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM coupons WHERE id=$1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "coupon not found" });
    audit(req.user, "coupon.delete", "coupon:" + req.params.id, "");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Content management — site settings (homepage banner, store name)
// ---------------------------------------------------------------------------

// Public: editable site content, returned as a flat { key: value } object.
app.get("/api/settings", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT key, value FROM settings");
    res.json({ settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: upsert one or more settings keys from a flat { key: value } body.
app.put("/api/admin/settings", authRequired, adminRequired, async (req, res) => {
  try {
    const updates = req.body || {};
    const keys = Object.keys(updates);
    if (!keys.length) return res.status(400).json({ error: "no settings provided" });
    for (const key of keys) {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ($1,$2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, String(updates[key] ?? "")]
      );
    }
    audit(req.user, "settings.update", "", keys.join(", "));
    const { rows } = await pool.query("SELECT key, value FROM settings");
    res.json({ settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Products/core API listening on :${PORT}`));
