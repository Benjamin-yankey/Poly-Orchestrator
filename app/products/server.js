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
const {
  signToken,
  authRequired,
  adminRequired,
  managementRead,
  requireCap,
  requireCapRead,
  ROLES,
} = require("./auth");
const { DEPARTMENTS, hasCap } = require("./capabilities");

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
  // Only set for internal employees; drives the employee dashboard's capability
  // gating. null for admins/staffing/customers.
  department: u.department || null,
  created_at: u.created_at,
});

// Product photos and listing photos are both uploaded as base64 data URLs.
// Validate the prefix so we never persist arbitrary strings as "images".
const isDataImage = (s) => /^data:image\/(png|jpe?g|webp|gif);base64,/.test(s);

// Best-effort card brand from the number, used only as a label for a saved card.
function cardBrand(number) {
  const n = String(number || "").replace(/\D/g, "");
  if (/^4/.test(n)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(n)) return "Mastercard";
  if (/^3[47]/.test(n)) return "Amex";
  if (/^6/.test(n)) return "Discover";
  return "Card";
}

// Parse "MM/YY" or "MM/YYYY" into { month, year } (nulls when unparseable).
function parseExpiry(s) {
  const m = /^(\d{1,2})\s*\/\s*(\d{2,4})$/.exec(String(s || "").trim());
  if (!m) return { month: null, year: null };
  const month = Number(m[1]);
  let year = Number(m[2]);
  if (year < 100) year += 2000;
  return { month: month >= 1 && month <= 12 ? month : null, year };
}

// One-line snapshot of an address row, stored on the order it shipped to.
function formatAddress(a) {
  return [
    a.full_name,
    a.line1,
    a.line2,
    [a.city, a.region, a.postal_code].filter(Boolean).join(" "),
    a.country,
  ]
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .join(", ");
}

// Order fulfilment lifecycle. "paid" is where every order starts (the mock
// gateway charged successfully); admins move it forward, or to a terminal
// cancelled/refunded state.
const ORDER_STATUSES = ["paid", "processing", "shipped", "delivered", "cancelled", "refunded"];

// Return-request lifecycle. A customer opens one ("requested"); an admin approves
// or rejects it, then marks it "refunded" once the money is returned (which also
// flips the underlying order to "refunded").
const RETURN_STATUSES = ["requested", "approved", "rejected", "refunded"];
// Statuses an order must be in before a return can be requested against it.
const RETURNABLE_STATUSES = ["shipped", "delivered"];

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

// Drop an in-app notification for a user. Best-effort, like audit() — a logging
// failure must never break the action (order, return, reply) that triggered it.
async function notify(userId, { kind = "info", title, body = "", link = "" }) {
  try {
    if (!userId || !title) return;
    await pool.query(
      `INSERT INTO notifications (user_id, kind, title, body, link)
       VALUES ($1,$2,$3,$4,$5)`,
      [userId, kind, title, body, link]
    );
  } catch (e) {
    console.error("notify failed:", e.message);
  }
}

// Ping every management user (admin + staffing_team) about a support event,
// skipping whoever triggered it. Best-effort, same contract as notify().
async function notifyManagement(exceptUserId, payload) {
  try {
    const { rows } = await pool.query(
      "SELECT id FROM users WHERE role IN ('admin','staffing_team')"
    );
    await Promise.all(
      rows.filter((r) => r.id !== exceptUserId).map((r) => notify(r.id, payload))
    );
  } catch (e) {
    console.error("notifyManagement failed:", e.message);
  }
}

// Support-ticket lifecycle.
const TICKET_STATUSES = ["open", "pending", "resolved", "closed"];

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
    -- Employees belong to an operational department (support, warehouse, …) that
    -- decides which dashboard areas they can use. NULL for non-employee roles.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;
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
    );
    -- Product reviews. A shopper leaves one rating per product; reviews are held
    -- for moderation (approved=false) until an admin approves them for display.
    CREATE TABLE IF NOT EXISTS reviews (
      id         SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment    TEXT NOT NULL DEFAULT '',
      approved   BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (product_id, user_id)
    );
    -- Saved shipping/billing addresses in the customer's address book. One may be
    -- flagged the default (pre-selected at checkout).
    CREATE TABLE IF NOT EXISTS addresses (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label       TEXT NOT NULL DEFAULT 'Home',
      full_name   TEXT NOT NULL DEFAULT '',
      line1       TEXT NOT NULL,
      line2       TEXT NOT NULL DEFAULT '',
      city        TEXT NOT NULL DEFAULT '',
      region      TEXT NOT NULL DEFAULT '',
      postal_code TEXT NOT NULL DEFAULT '',
      country     TEXT NOT NULL DEFAULT '',
      phone       TEXT NOT NULL DEFAULT '',
      is_default  BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Saved payment methods. We NEVER store a full card number — only the brand,
    -- the last four digits and the expiry, which is all the mock gateway needs to
    -- show a "card on file". One may be flagged the default.
    CREATE TABLE IF NOT EXISTS payment_methods (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      brand      TEXT NOT NULL DEFAULT 'Card',
      last4      TEXT NOT NULL,
      exp_month  INTEGER,
      exp_year   INTEGER,
      holder     TEXT NOT NULL DEFAULT '',
      is_default BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Orders remember where they shipped (a formatted snapshot of the chosen
    -- address) so it stays correct even if the address book later changes.
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_to TEXT NOT NULL DEFAULT '';
    -- When the customer confirms they received an order, we stamp the time.
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
    -- Customer-initiated return/refund requests against a delivered order. The
    -- admin moves one through requested -> approved/rejected -> refunded.
    CREATE TABLE IF NOT EXISTS returns (
      id         SERIAL PRIMARY KEY,
      order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason     TEXT NOT NULL DEFAULT '',
      status     TEXT NOT NULL DEFAULT 'requested',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Customer support: a ticket is a conversation between a shopper and staff.
    CREATE TABLE IF NOT EXISTS support_tickets (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject    TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS support_messages (
      id          SERIAL PRIMARY KEY,
      ticket_id   INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      author_role TEXT NOT NULL DEFAULT 'customer',
      body        TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- In-app notifications. Auto-created on order/return/support events so the
    -- shopper sees a bell badge without any external email/SMS.
    CREATE TABLE IF NOT EXISTS notifications (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL DEFAULT 'info',
      title      TEXT NOT NULL,
      body       TEXT NOT NULL DEFAULT '',
      link       TEXT NOT NULL DEFAULT '',
      read       BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
    { email: "admin@shopnow.local", password: "admin123", name: "Store Admin", role: "admin", department: null },
    { email: "staff@shopnow.local", password: "staff123", name: "Staffing Team", role: "staffing_team", department: null },
    { email: "employee@shopnow.local", password: "employee123", name: "Order Processing Employee", role: "employee", department: "order_processing" },
    { email: "warehouse@shopnow.local", password: "warehouse123", name: "Warehouse Employee", role: "employee", department: "warehouse" },
    { email: "support@shopnow.local", password: "support123", name: "Support Employee", role: "employee", department: "support" },
    { email: "demo@shopnow.local", password: "demo123", name: "Demo Customer", role: "customer", department: null },
  ];
  for (const u of seeds) {
    const hash = await bcrypt.hash(u.password, 10);
    await pool.query(
      `INSERT INTO users (email, password_hash, name, role, department)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (email) DO NOTHING`,
      [u.email, hash, u.name, u.role, u.department]
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

// Public: approved reviews for a product, plus the average rating and count.
app.get("/api/products/:id/reviews", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.rating, r.comment, r.created_at, u.name AS author
         FROM reviews r JOIN users u ON u.id = r.user_id
        WHERE r.product_id = $1 AND r.approved = true
        ORDER BY r.id DESC`,
      [req.params.id]
    );
    const { rows: agg } = await pool.query(
      `SELECT COALESCE(AVG(rating),0)::numeric(3,2) AS average, COUNT(*)::int AS count
         FROM reviews WHERE product_id = $1 AND approved = true`,
      [req.params.id]
    );
    res.json({ reviews: rows, average: Number(agg[0].average), count: agg[0].count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Submit (or update) the caller's review for a product. Re-submitting overwrites
// the previous one and sends it back to moderation (approved = false).
app.post("/api/products/:id/reviews", authRequired, async (req, res) => {
  try {
    const { rating, comment } = req.body || {};
    const r = Number(rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      return res.status(400).json({ error: "rating must be an integer from 1 to 5" });
    }
    const { rows: prod } = await pool.query("SELECT id FROM products WHERE id=$1", [req.params.id]);
    if (!prod.length) return res.status(404).json({ error: "product not found" });
    const { rows } = await pool.query(
      `INSERT INTO reviews (product_id, user_id, rating, comment, approved)
       VALUES ($1,$2,$3,$4,false)
       ON CONFLICT (product_id, user_id)
       DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment,
                     approved = false, created_at = now()
       RETURNING id, rating, comment, approved, created_at`,
      [req.params.id, req.user.sub, r, String(comment || "")]
    );
    res.status(201).json({ review: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Admin catalog management -------------------------------------------------
app.post("/api/products", authRequired, requireCap("products.manage"), async (req, res) => {
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

app.put("/api/products/:id", authRequired, requireCap("products.manage"), async (req, res) => {
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

app.delete("/api/products/:id", authRequired, requireCap("products.manage"), async (req, res) => {
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
      "SELECT id, email, name, role, department, created_at FROM users WHERE id=$1",
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
       RETURNING id, email, name, role, department, created_at`,
      [req.user.sub, name]
    );
    if (!rows.length) return res.status(404).json({ error: "user not found" });
    res.json({ user: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Address book (saved shipping/billing addresses)
// ---------------------------------------------------------------------------
const ADDRESS_COLS =
  "id, label, full_name, line1, line2, city, region, postal_code, country, phone, is_default, created_at";

app.get("/api/addresses", authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${ADDRESS_COLS} FROM addresses WHERE user_id=$1 ORDER BY is_default DESC, id DESC`,
      [req.user.sub]
    );
    res.json({ addresses: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/addresses", authRequired, async (req, res) => {
  const client = await pool.connect();
  try {
    const a = req.body || {};
    if (!a.line1 || !String(a.line1).trim()) {
      return res.status(400).json({ error: "address line 1 is required" });
    }
    const makeDefault = !!a.is_default;
    await client.query("BEGIN");
    // First address is the default by definition; otherwise honour the flag.
    const { rows: cnt } = await client.query(
      "SELECT COUNT(*)::int AS n FROM addresses WHERE user_id=$1",
      [req.user.sub]
    );
    const isDefault = makeDefault || cnt[0].n === 0;
    if (isDefault) {
      await client.query("UPDATE addresses SET is_default=false WHERE user_id=$1", [req.user.sub]);
    }
    const { rows } = await client.query(
      `INSERT INTO addresses (user_id, label, full_name, line1, line2, city, region, postal_code, country, phone, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${ADDRESS_COLS}`,
      [
        req.user.sub,
        a.label || "Home",
        a.full_name || "",
        a.line1,
        a.line2 || "",
        a.city || "",
        a.region || "",
        a.postal_code || "",
        a.country || "",
        a.phone || "",
        isDefault,
      ]
    );
    await client.query("COMMIT");
    res.status(201).json({ address: rows[0] });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.put("/api/addresses/:id", authRequired, async (req, res) => {
  try {
    const a = req.body || {};
    const { rows } = await pool.query(
      `UPDATE addresses SET
         label=COALESCE($3,label), full_name=COALESCE($4,full_name), line1=COALESCE($5,line1),
         line2=COALESCE($6,line2), city=COALESCE($7,city), region=COALESCE($8,region),
         postal_code=COALESCE($9,postal_code), country=COALESCE($10,country), phone=COALESCE($11,phone)
       WHERE id=$1 AND user_id=$2 RETURNING ${ADDRESS_COLS}`,
      [
        Number(req.params.id),
        req.user.sub,
        a.label ?? null,
        a.full_name ?? null,
        a.line1 ?? null,
        a.line2 ?? null,
        a.city ?? null,
        a.region ?? null,
        a.postal_code ?? null,
        a.country ?? null,
        a.phone ?? null,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: "address not found" });
    res.json({ address: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Make an address the default (unsets any previous default for this user).
app.put("/api/addresses/:id/default", authRequired, async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    await client.query("BEGIN");
    const { rowCount } = await client.query(
      "SELECT 1 FROM addresses WHERE id=$1 AND user_id=$2",
      [id, req.user.sub]
    );
    if (!rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "address not found" });
    }
    await client.query("UPDATE addresses SET is_default=false WHERE user_id=$1", [req.user.sub]);
    await client.query("UPDATE addresses SET is_default=true WHERE id=$1", [id]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.delete("/api/addresses/:id", authRequired, async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM addresses WHERE id=$1 AND user_id=$2", [
      Number(req.params.id),
      req.user.sub,
    ]);
    if (!rowCount) return res.status(404).json({ error: "address not found" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Saved payment methods (only brand + last4 + expiry are stored)
// ---------------------------------------------------------------------------
const PM_COLS = "id, brand, last4, exp_month, exp_year, holder, is_default, created_at";

app.get("/api/payment-methods", authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${PM_COLS} FROM payment_methods WHERE user_id=$1 ORDER BY is_default DESC, id DESC`,
      [req.user.sub]
    );
    res.json({ methods: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Save a card on file. We accept the full number to validate it, then KEEP ONLY
// the last four digits + brand + expiry — the PAN is never persisted.
app.post("/api/payment-methods", authRequired, async (req, res) => {
  const client = await pool.connect();
  try {
    const { cardNumber, holder, expiry, is_default } = req.body || {};
    const digits = String(cardNumber || "").replace(/\D/g, "");
    if (digits.length < 12) return res.status(400).json({ error: "enter a valid card number" });
    const { month, year } = parseExpiry(expiry);
    const makeDefault = !!is_default;
    await client.query("BEGIN");
    const { rows: cnt } = await client.query(
      "SELECT COUNT(*)::int AS n FROM payment_methods WHERE user_id=$1",
      [req.user.sub]
    );
    const isDefault = makeDefault || cnt[0].n === 0;
    if (isDefault) {
      await client.query("UPDATE payment_methods SET is_default=false WHERE user_id=$1", [req.user.sub]);
    }
    const { rows } = await client.query(
      `INSERT INTO payment_methods (user_id, brand, last4, exp_month, exp_year, holder, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${PM_COLS}`,
      [req.user.sub, cardBrand(digits), digits.slice(-4), month, year, holder || "", isDefault]
    );
    await client.query("COMMIT");
    res.status(201).json({ method: rows[0] });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.put("/api/payment-methods/:id/default", authRequired, async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    await client.query("BEGIN");
    const { rowCount } = await client.query(
      "SELECT 1 FROM payment_methods WHERE id=$1 AND user_id=$2",
      [id, req.user.sub]
    );
    if (!rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "payment method not found" });
    }
    await client.query("UPDATE payment_methods SET is_default=false WHERE user_id=$1", [req.user.sub]);
    await client.query("UPDATE payment_methods SET is_default=true WHERE id=$1", [id]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.delete("/api/payment-methods/:id", authRequired, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM payment_methods WHERE id=$1 AND user_id=$2",
      [Number(req.params.id), req.user.sub]
    );
    if (!rowCount) return res.status(404).json({ error: "payment method not found" });
    res.json({ ok: true });
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
    const { items, payment, couponCode, addressId, paymentMethodId } = req.body || {};
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

    // Resolve the shipping address from the caller's address book (when chosen),
    // snapshotting it onto the order so it stays correct if the book changes.
    let shipTo = "";
    if (addressId) {
      const { rows: addr } = await pool.query(
        "SELECT * FROM addresses WHERE id=$1 AND user_id=$2",
        [Number(addressId), req.user.sub]
      );
      if (!addr.length) return res.status(400).json({ error: "shipping address not found" });
      shipTo = formatAddress(addr[0]);
    }

    // Charge via a saved card on file (must belong to the caller) or the typed
    // card. A saved card is always approved by the mock gateway; typed cards still
    // run through mockCharge (so the "ends in 0000 declines" test still works).
    let charge;
    if (paymentMethodId) {
      const { rows: pm } = await pool.query(
        "SELECT last4 FROM payment_methods WHERE id=$1 AND user_id=$2",
        [Number(paymentMethodId), req.user.sub]
      );
      if (!pm.length) return res.status(400).json({ error: "payment method not found" });
      charge = { ok: true, ref: "MOCK-SAVED-" + Date.now().toString(36).toUpperCase() + "-" + pm[0].last4 };
    } else {
      charge = mockCharge(payment, total);
    }
    if (!charge.ok) return res.status(402).json({ error: `payment failed: ${charge.reason}` });

    await client.query("BEGIN");
    const { rows: orderRows } = await client.query(
      `INSERT INTO orders (user_id, total, status, payment_ref, ship_to)
       VALUES ($1,$2,'paid',$3,$4) RETURNING id, total, status, payment_ref, ship_to, created_at`,
      [req.user.sub, total.toFixed(2), charge.ref, shipTo]
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
    notify(req.user.sub, {
      kind: "order",
      title: `Order #${order.id} confirmed`,
      body: `We received your payment of $${Number(order.total).toFixed(2)}. Thanks for shopping!`,
      link: "/orders",
    });
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
      `SELECT id, total, status, payment_ref, carrier, tracking, ship_to, received_at, created_at
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

// Customer confirms they received an order (only their own, once it has shipped).
app.put("/api/orders/:id/confirm-receipt", authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT user_id, status FROM orders WHERE id=$1", [
      Number(req.params.id),
    ]);
    const order = rows[0];
    if (!order) return res.status(404).json({ error: "order not found" });
    if (order.user_id !== req.user.sub) return res.status(403).json({ error: "forbidden" });
    if (!["shipped", "delivered"].includes(order.status)) {
      return res.status(400).json({ error: "order has not shipped yet" });
    }
    // Mark received, and advance to "delivered" if it was still in transit.
    const { rows: upd } = await pool.query(
      `UPDATE orders SET received_at = now(),
         status = CASE WHEN status = 'shipped' THEN 'delivered' ELSE status END
       WHERE id=$1 RETURNING id, total, status, payment_ref, carrier, tracking, ship_to, received_at, created_at`,
      [Number(req.params.id)]
    );
    audit(req.user, "order.receipt", "order:" + req.params.id, "");
    res.json({ order: upd[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Returns & refunds (customer-initiated)
// ---------------------------------------------------------------------------

// Open a return request against one of the caller's own orders.
app.post("/api/orders/:id/return", authRequired, async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const { reason } = req.body || {};
    const { rows } = await pool.query("SELECT user_id, status FROM orders WHERE id=$1", [orderId]);
    const order = rows[0];
    if (!order) return res.status(404).json({ error: "order not found" });
    if (order.user_id !== req.user.sub) return res.status(403).json({ error: "forbidden" });
    if (!RETURNABLE_STATUSES.includes(order.status)) {
      return res.status(400).json({ error: "only shipped or delivered orders can be returned" });
    }
    // One open request per order — block duplicates while one is in flight.
    const { rows: existing } = await pool.query(
      "SELECT id FROM returns WHERE order_id=$1 AND status IN ('requested','approved')",
      [orderId]
    );
    if (existing.length) {
      return res.status(409).json({ error: "a return is already in progress for this order" });
    }
    const { rows: ret } = await pool.query(
      `INSERT INTO returns (order_id, user_id, reason, status)
       VALUES ($1,$2,$3,'requested') RETURNING id, order_id, reason, status, created_at, updated_at`,
      [orderId, req.user.sub, String(reason || "")]
    );
    audit(req.user, "return.request", "order:" + orderId, ret[0].reason);
    res.status(201).json({ return: ret[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// The caller's own return requests (with a little order context).
app.get("/api/returns", authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.order_id, r.reason, r.status, r.created_at, r.updated_at,
              o.total AS order_total
         FROM returns r JOIN orders o ON o.id = r.order_id
        WHERE r.user_id = $1 ORDER BY r.id DESC`,
      [req.user.sub]
    );
    res.json({ returns: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Admin views --------------------------------------------------------------
app.get("/api/admin/orders", authRequired, requireCapRead("orders.manage"), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.total, o.status, o.payment_ref, o.carrier, o.tracking, o.ship_to, o.created_at,
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
app.put("/api/admin/orders/:id/status", authRequired, requireCap("orders.manage"), async (req, res) => {
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
       RETURNING id, user_id, total, status, payment_ref, carrier, tracking, ship_to, received_at, created_at`,
      [Number(req.params.id), status, carrier ?? null, tracking ?? null]
    );
    if (!rows.length) return res.status(404).json({ error: "order not found" });
    audit(req.user, "order.status", "order:" + rows[0].id, status);
    const trackInfo = rows[0].tracking ? ` ${rows[0].carrier} tracking ${rows[0].tracking}.` : "";
    notify(rows[0].user_id, {
      kind: "order",
      title: `Order #${rows[0].id} is now ${status}`,
      body: `Your order status changed to "${status}".${trackInfo}`,
      link: "/orders",
    });
    res.json({ order: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Admin returns queue ------------------------------------------------------

// Every return request with order + customer context, for the Returns tab.
app.get("/api/admin/returns", authRequired, requireCapRead("returns.manage"), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.order_id, r.reason, r.status, r.created_at, r.updated_at,
              o.total AS order_total, o.status AS order_status,
              u.name AS customer_name, u.email AS customer_email
         FROM returns r
         JOIN orders o ON o.id = r.order_id
         JOIN users  u ON u.id = r.user_id
        ORDER BY r.id DESC`
    );
    res.json({ returns: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Move a return through its lifecycle. Marking it "refunded" also flips the
// underlying order to "refunded" (the mock gateway issues no external call).
app.put("/api/admin/returns/:id/status", authRequired, requireCap("returns.manage"), async (req, res) => {
  const client = await pool.connect();
  try {
    const { status } = req.body || {};
    if (!RETURN_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${RETURN_STATUSES.join(", ")}` });
    }
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE returns SET status=$2, updated_at=now() WHERE id=$1
       RETURNING id, order_id, user_id, reason, status, created_at, updated_at`,
      [Number(req.params.id), status]
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "return not found" });
    }
    if (status === "refunded") {
      await client.query("UPDATE orders SET status='refunded' WHERE id=$1", [rows[0].order_id]);
    }
    await client.query("COMMIT");
    audit(req.user, "return.status", "return:" + rows[0].id, status);
    notify(rows[0].user_id, {
      kind: "return",
      title: `Return for order #${rows[0].order_id} ${status}`,
      body:
        status === "refunded"
          ? "Your refund has been issued against the original payment."
          : `Your return request was ${status}.`,
      link: "/orders",
    });
    res.json({ return: rows[0] });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Dashboard stats for the admin home. Returns headline counters plus a few
// breakdowns the dashboard charts render (revenue per day, stock health,
// listings per category, top-selling products).
app.get("/api/admin/stats", authRequired, requireCapRead("reports.view"), async (_req, res) => {
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
      `SELECT u.id, u.email, u.name, u.role, u.department, u.active, u.created_at,
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
    const { email, password, name, role, department } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email and password are required" });
    if (String(password).length < 6) {
      return res.status(400).json({ error: "password must be at least 6 characters" });
    }
    if (role && !ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${ROLES.join(", ")}` });
    }
    // A department only applies to employees; ignore it for every other role.
    const dept = (role || "customer") === "employee" ? department || null : null;
    if (dept && !DEPARTMENTS.includes(dept)) {
      return res.status(400).json({ error: `department must be one of: ${DEPARTMENTS.join(", ")}` });
    }
    const hash = await bcrypt.hash(password, 10);
    let rows;
    try {
      ({ rows } = await pool.query(
        `INSERT INTO users (email, password_hash, name, role, department)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, email, name, role, department, created_at`,
        [String(email).toLowerCase(), hash, name || "", role || "customer", dept]
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
    // Department is only meaningful for employees; clear it on any other role so
    // a demoted/promoted account never keeps stale capabilities.
    const { rows } = await pool.query(
      `UPDATE users SET role=$2,
              department = CASE WHEN $2 = 'employee' THEN department ELSE NULL END
        WHERE id=$1 RETURNING id, email, name, role, department, created_at`,
      [id, role]
    );
    if (!rows.length) return res.status(404).json({ error: "user not found" });
    audit(req.user, "user.role", "user:" + rows[0].id, `${rows[0].email} → ${role}`);
    res.json({ user: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Assign (or clear) an employee's department. Only admins may do this. The
// department is what grants an employee their operational capabilities, so this
// is the lever that decides which dashboard areas they can use. Only valid on
// accounts whose role is 'employee'.
app.put("/api/admin/users/:id/department", authRequired, adminRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const department = req.body?.department || null;
    if (department && !DEPARTMENTS.includes(department)) {
      return res.status(400).json({ error: `department must be one of: ${DEPARTMENTS.join(", ")}` });
    }
    const { rows: cur } = await pool.query("SELECT role FROM users WHERE id=$1", [id]);
    if (!cur.length) return res.status(404).json({ error: "user not found" });
    if (cur[0].role !== "employee") {
      return res.status(400).json({ error: "only employee accounts have a department" });
    }
    const { rows } = await pool.query(
      "UPDATE users SET department=$2 WHERE id=$1 RETURNING id, email, name, role, department, created_at",
      [id, department]
    );
    audit(req.user, "user.department", "user:" + id, `${rows[0].email} → ${department || "none"}`);
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
    const active = !!req.body?.active;
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
    const coupon = await findValidCoupon(req.body?.code);
    if (!coupon) return res.status(404).json({ error: "invalid or expired coupon" });
    res.json({ coupon });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin coupon management.
app.get("/api/admin/coupons", authRequired, requireCapRead("coupons.manage"), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, code, percent_off, active, expires_at, created_at FROM coupons ORDER BY id DESC"
    );
    res.json({ coupons: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/admin/coupons", authRequired, requireCap("coupons.manage"), async (req, res) => {
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
app.put("/api/admin/coupons/:id", authRequired, requireCap("coupons.manage"), async (req, res) => {
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

app.delete("/api/admin/coupons/:id", authRequired, requireCap("coupons.manage"), async (req, res) => {
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

// ---------------------------------------------------------------------------
// Review & rating moderation
// ---------------------------------------------------------------------------

// Every review (approved or not) with product + author context, for moderation.
app.get("/api/admin/reviews", authRequired, requireCapRead("reviews.manage"), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.product_id, r.rating, r.comment, r.approved, r.created_at,
              p.name AS product_name, u.name AS author, u.email AS author_email
         FROM reviews r
         JOIN products p ON p.id = r.product_id
         JOIN users u ON u.id = r.user_id
        ORDER BY r.id DESC`
    );
    res.json({ reviews: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Approve (or un-approve) a review so it shows on the storefront.
app.put("/api/admin/reviews/:id/approve", authRequired, requireCap("reviews.manage"), async (req, res) => {
  try {
    const approved = req.body?.approved !== false; // defaults to true
    const { rows } = await pool.query(
      "UPDATE reviews SET approved=$2 WHERE id=$1 RETURNING id, product_id, rating, approved",
      [Number(req.params.id), approved]
    );
    if (!rows.length) return res.status(404).json({ error: "review not found" });
    audit(req.user, approved ? "review.approve" : "review.unapprove", "review:" + rows[0].id, "");
    res.json({ review: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/admin/reviews/:id", authRequired, requireCap("reviews.manage"), async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM reviews WHERE id=$1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "review not found" });
    audit(req.user, "review.delete", "review:" + req.params.id, "");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Customer support — tickets + threaded messages
// ---------------------------------------------------------------------------
// Can view any ticket (the support queue): management roles, plus support-
// department employees.
const isManagement = (req) =>
  ["admin", "staffing_team"].includes(req.user?.role) ||
  (req.user?.role === "employee" && hasCap(req.user.department, "support.manage"));
// Can write a "staff" reply: admins and support-department employees. (staffing_team
// is read-only and only sees the queue.)
const isStaffReply = (req) =>
  req.user?.role === "admin" ||
  (req.user?.role === "employee" && hasCap(req.user.department, "support.manage"));

// Open a ticket with an initial message.
app.post("/api/support", authRequired, async (req, res) => {
  const client = await pool.connect();
  try {
    const { subject, message } = req.body || {};
    if (!subject || !String(subject).trim()) return res.status(400).json({ error: "subject is required" });
    if (!message || !String(message).trim()) return res.status(400).json({ error: "message is required" });
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO support_tickets (user_id, subject) VALUES ($1,$2)
       RETURNING id, subject, status, created_at, updated_at`,
      [req.user.sub, String(subject).trim()]
    );
    await client.query(
      `INSERT INTO support_messages (ticket_id, author_id, author_role, body)
       VALUES ($1,$2,'customer',$3)`,
      [rows[0].id, req.user.sub, String(message).trim()]
    );
    await client.query("COMMIT");
    // Alert the support team that a new ticket is waiting.
    notifyManagement(req.user.sub, {
      kind: "support",
      title: `New support ticket: "${rows[0].subject}"`,
      body: String(message).trim().slice(0, 140),
      link: "/admin",
    });
    res.status(201).json({ ticket: rows[0] });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// The caller's own tickets, with a reply count and last-activity time.
app.get("/api/support", authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.subject, t.status, t.created_at, t.updated_at,
              COUNT(m.id)::int AS messages
         FROM support_tickets t
         LEFT JOIN support_messages m ON m.ticket_id = t.id
        WHERE t.user_id = $1
        GROUP BY t.id ORDER BY t.updated_at DESC`,
      [req.user.sub]
    );
    res.json({ tickets: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// A single ticket with its full message thread. The owner or any management
// user may read it.
app.get("/api/support/:id", authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM support_tickets WHERE id=$1", [
      Number(req.params.id),
    ]);
    const ticket = rows[0];
    if (!ticket) return res.status(404).json({ error: "ticket not found" });
    if (ticket.user_id !== req.user.sub && !isManagement(req)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const { rows: messages } = await pool.query(
      `SELECT m.id, m.author_role, m.body, m.created_at, u.name AS author
         FROM support_messages m LEFT JOIN users u ON u.id = m.author_id
        WHERE m.ticket_id = $1 ORDER BY m.id`,
      [ticket.id]
    );
    res.json({ ticket, messages });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Post a reply. The owner replies as "customer"; an admin replies as "staff".
// A customer reply on a resolved/closed ticket reopens it; a staff reply marks
// it "pending" (awaiting the customer) and notifies them.
app.post("/api/support/:id/messages", authRequired, async (req, res) => {
  try {
    const { body } = req.body || {};
    if (!body || !String(body).trim()) return res.status(400).json({ error: "message body is required" });
    const { rows } = await pool.query("SELECT * FROM support_tickets WHERE id=$1", [
      Number(req.params.id),
    ]);
    const ticket = rows[0];
    if (!ticket) return res.status(404).json({ error: "ticket not found" });
    const owner = ticket.user_id === req.user.sub;
    if (!owner && !isManagement(req)) return res.status(403).json({ error: "forbidden" });
    // Only the owner or an admin can actually write; staffing_team is read-only.
    if (!owner && !isStaffReply(req)) return res.status(403).json({ error: "read-only access" });

    const role = owner ? "customer" : "staff";
    const { rows: msg } = await pool.query(
      `INSERT INTO support_messages (ticket_id, author_id, author_role, body)
       VALUES ($1,$2,$3,$4) RETURNING id, author_role, body, created_at`,
      [ticket.id, req.user.sub, role, String(body).trim()]
    );
    const newStatus = role === "staff" ? "pending" : "open";
    await pool.query("UPDATE support_tickets SET status=$2, updated_at=now() WHERE id=$1", [
      ticket.id,
      newStatus,
    ]);
    // A staff reply pings the ticket owner; a customer reply pings the team.
    if (role === "staff") {
      notify(ticket.user_id, {
        kind: "support",
        title: `Support replied to "${ticket.subject}"`,
        body: String(body).trim().slice(0, 140),
        link: "/support",
      });
    } else {
      notifyManagement(req.user.sub, {
        kind: "support",
        title: `Customer replied to "${ticket.subject}"`,
        body: String(body).trim().slice(0, 140),
        link: "/admin",
      });
    }
    res.status(201).json({ message: msg[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Admin support queue ------------------------------------------------------
app.get("/api/admin/support", authRequired, requireCapRead("support.manage"), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.subject, t.status, t.created_at, t.updated_at,
              COUNT(m.id)::int AS messages,
              u.name AS customer_name, u.email AS customer_email
         FROM support_tickets t
         JOIN users u ON u.id = t.user_id
         LEFT JOIN support_messages m ON m.ticket_id = t.id
        GROUP BY t.id, u.name, u.email ORDER BY t.updated_at DESC`
    );
    res.json({ tickets: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/admin/support/:id/status", authRequired, requireCap("support.manage"), async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!TICKET_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${TICKET_STATUSES.join(", ")}` });
    }
    const { rows } = await pool.query(
      `UPDATE support_tickets SET status=$2, updated_at=now() WHERE id=$1
       RETURNING id, user_id, subject, status, created_at, updated_at`,
      [Number(req.params.id), status]
    );
    if (!rows.length) return res.status(404).json({ error: "ticket not found" });
    audit(req.user, "support.status", "ticket:" + rows[0].id, status);
    notify(rows[0].user_id, {
      kind: "support",
      title: `Your ticket "${rows[0].subject}" is ${status}`,
      body: `A support agent set your ticket to "${status}".`,
      link: "/support",
    });
    res.json({ ticket: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Notifications (in-app)
// ---------------------------------------------------------------------------

// The caller's notifications (newest first) plus the unread count for the badge.
app.get("/api/notifications", authRequired, async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const { rows } = await pool.query(
      `SELECT id, kind, title, body, link, read, created_at
         FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT $2`,
      [req.user.sub, limit]
    );
    const { rows: u } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM notifications WHERE user_id=$1 AND read=false",
      [req.user.sub]
    );
    res.json({ notifications: rows, unread: u[0].n });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/notifications/:id/read", authRequired, async (req, res) => {
  try {
    await pool.query("UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2", [
      Number(req.params.id),
      req.user.sub,
    ]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/notifications/read-all", authRequired, async (req, res) => {
  try {
    await pool.query("UPDATE notifications SET read=true WHERE user_id=$1 AND read=false", [
      req.user.sub,
    ]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Products/core API listening on :${PORT}`));
