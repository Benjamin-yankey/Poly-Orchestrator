// ShopNow — Products microservice
// Owns the product catalog. This is the ONLY service that talks to Postgres
// (database-per-service). It knows nothing about carts, Redis, or the frontend.

const express = require("express");
const { Pool } = require("pg");

const app = express();
app.disable("x-powered-by");
const PORT = process.env.PORT || 5001;

const pool = new Pool({
  host: process.env.PG_HOST || "postgres",
  port: process.env.PG_PORT || 5432,
  user: process.env.PG_USER || "shopnow",
  password: process.env.PG_PASSWORD || "shopnow_pass",
  database: process.env.PG_DATABASE || "shopnow",
});

// Create + seed the catalog on startup (idempotent, with retry while PG boots).
async function initDb() {
  const createSql = `
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      price NUMERIC(10,2) NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      icon TEXT NOT NULL DEFAULT '📦'
    );`;
  const seedSql = `
    INSERT INTO products (name, price, category, icon)
    SELECT * FROM (VALUES
      ('Wireless Mouse', 24.99, 'Accessories', '🖱️'),
      ('Mechanical Keyboard', 89.50, 'Accessories', '⌨️'),
      ('27" Monitor', 219.00, 'Displays', '🖥️'),
      ('USB-C Hub', 39.95, 'Accessories', '🔌'),
      ('Noise-Cancelling Headphones', 149.00, 'Audio', '🎧'),
      ('1080p Webcam', 59.99, 'Accessories', '📷'),
      ('Laptop Stand', 34.50, 'Office', '💻'),
      ('LED Desk Lamp', 27.00, 'Office', '💡')
    ) AS v(name, price, category, icon)
    WHERE NOT EXISTS (SELECT 1 FROM products);`;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await pool.query(createSql);
      await pool.query(seedSql);
      console.log("Postgres ready and catalog seeded.");
      return;
    } catch (e) {
      console.log(`DB not ready (attempt ${attempt}/10): ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  console.error("Gave up initialising Postgres.");
}
initDb();

app.get("/health", (_req, res) => res.json({ status: "ok", service: "products" }));

// Returns the catalog plus which instance served the request (for the
// load-balancing / self-healing demo).
app.get("/api/products", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, name, price, category, icon FROM products ORDER BY id");
    res.json({ servedBy: process.env.HOSTNAME || "unknown", products: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Products service listening on :${PORT}`));
