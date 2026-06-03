// ShopNow — Frontend
// Top tier. Serves the built Angular SPA and reverse-proxies /api/* to the two
// backend microservices, discovered independently via env vars (no hard-coded
// IPs). Routing is by path prefix:
//     /api/products*  /api/categories*  /api/listings*  /api/auth*  /api/orders*
//     /api/admin*  /api/coupons*  /api/settings*
//        -> Products / core API  (PRODUCTS_URL)
//     /api/cart*       /api/visits*
//        -> Cart service         (CART_URL)
// Anything that isn't /api and isn't a static asset falls through to index.html
// so the Angular client-side router can handle deep links / refreshes.

const express = require("express");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const app = express();
app.disable("x-powered-by");
const PORT = process.env.PORT || 8080;

const PRODUCTS_URL = process.env.PRODUCTS_URL || "http://products:5001";
const CART_URL = process.env.CART_URL || "http://cart:5002";

// The Angular build lands here in the image (see Dockerfile). Fall back to the
// legacy ./public folder if the SPA hasn't been built (e.g. bare local run).
const SPA_DIR = fs.existsSync(path.join(__dirname, "public", "index.html"))
  ? path.join(__dirname, "public")
  : path.join(__dirname, "public");

app.get("/health", (_req, res) => res.json({ status: "ok", tier: "frontend" }));

// Pick the downstream service based on the request path prefix.
const PRODUCTS_PREFIXES = ["/api/products", "/api/categories", "/api/listings", "/api/auth", "/api/orders", "/api/admin", "/api/coupons", "/api/settings"];
const CART_PREFIXES = ["/api/cart", "/api/visits"];

function targetFor(reqPath) {
  if (PRODUCTS_PREFIXES.some((p) => reqPath.startsWith(p))) return PRODUCTS_URL;
  if (CART_PREFIXES.some((p) => reqPath.startsWith(p))) return CART_URL;
  return null;
}

// Minimal reverse proxy. We stream the request/response untouched (including the
// Authorization header and JSON bodies) so we never need to parse them here.
app.use("/api", (req, res) => {
  const fullPath = "/api" + req.url; // req.url is relative to the /api mount
  const base = targetFor(fullPath);
  if (!base) return res.status(404).json({ error: "no route", path: fullPath });

  const target = new URL(base);
  const options = {
    hostname: target.hostname,
    port: target.port || 80,
    path: fullPath,
    method: req.method,
    headers: { ...req.headers, host: target.host },
  };
  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on("error", (err) => {
    res.status(502).json({ error: "service unreachable", target: base, detail: err.message });
  });
  req.pipe(proxyReq);
});

// Static assets (hashed JS/CSS, favicon, etc.).
app.use(express.static(SPA_DIR));

// SPA fallback: any other GET returns index.html for the Angular router.
app.get("*", (_req, res) => res.sendFile(path.join(SPA_DIR, "index.html")));

app.listen(PORT, () =>
  console.log(`Frontend on :${PORT} | products -> ${PRODUCTS_URL} | cart -> ${CART_URL}`)
);
