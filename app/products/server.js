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
const { signToken, authRequired, adminRequired } = require("./auth");

const app = express();
app.disable("x-powered-by");
app.use(express.json());
const PORT = process.env.PORT || 5001;

const pool = new Pool({
  host: process.env.PG_HOST || "postgres",
  port: process.env.PG_PORT || 5432,
  user: process.env.PG_USER || "shopnow",
  password: process.env.PG_PASSWORD || "shopnow_pass",
  database: process.env.PG_DATABASE || "shopnow",
});

const who = () => process.env.HOSTNAME || "unknown";
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role });

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
      `SELECT id, name, price, category, icon, description, stock
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
      "SELECT id, name, price, category, icon, description, stock FROM products WHERE id=$1",
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
    const { name, price, category, icon, description, stock } = req.body || {};
    if (!name || price == null) return res.status(400).json({ error: "name and price are required" });
    const { rows } = await pool.query(
      `INSERT INTO products (name, price, category, icon, description, stock)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, price, category, icon, description, stock`,
      [name, price, category || "General", icon || "📦", description || "", stock ?? 100]
    );
    res.status(201).json({ product: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/products/:id", authRequired, adminRequired, async (req, res) => {
  try {
    const { name, price, category, icon, description, stock } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE products SET
         name=COALESCE($2,name), price=COALESCE($3,price), category=COALESCE($4,category),
         icon=COALESCE($5,icon), description=COALESCE($6,description), stock=COALESCE($7,stock)
       WHERE id=$1
       RETURNING id, name, price, category, icon, description, stock`,
      [req.params.id, name, price, category, icon, description, stock]
    );
    if (!rows.length) return res.status(404).json({ error: "product not found" });
    res.json({ product: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/products/:id", authRequired, adminRequired, async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM products WHERE id=$1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "product not found" });
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
         RETURNING id, email, name, role`,
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
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Return the caller's profile (verifies the token is still valid).
app.get("/api/auth/me", authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, email, name, role FROM users WHERE id=$1", [
      req.user.sub,
    ]);
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
    const { items, payment } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "cart is empty" });
    }
    const total = items.reduce((s, it) => s + Number(it.price) * Number(it.qty), 0);

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
app.get("/api/admin/orders", authRequired, adminRequired, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.total, o.status, o.payment_ref, o.created_at,
              u.email AS customer_email, u.name AS customer_name
         FROM orders o JOIN users u ON u.id = o.user_id
       ORDER BY o.id DESC`
    );
    res.json({ orders: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Lightweight dashboard stats for the admin home.
app.get("/api/admin/stats", authRequired, adminRequired, async (_req, res) => {
  try {
    const [{ rows: p }, { rows: o }, { rows: u }] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS n FROM products"),
      pool.query("SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0)::numeric(12,2) AS revenue FROM orders"),
      pool.query("SELECT COUNT(*)::int AS n FROM users"),
    ]);
    res.json({
      products: p[0].n,
      orders: o[0].n,
      revenue: Number(o[0].revenue),
      users: u[0].n,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Products/core API listening on :${PORT}`));
