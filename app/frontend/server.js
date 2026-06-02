// ShopNow — Frontend
// Top tier. Serves the UI and reverse-proxies to the two backend microservices.
// It discovers each service independently via its own env var — no hard-coded
// IPs. The proxy routes by path prefix:
//     /api/products*  -> Products service  (PRODUCTS_URL)
//     /api/cart*      -> Cart service      (CART_URL)
//     /api/visits*    -> Cart service      (CART_URL)

const express = require("express");
const http = require("node:http");
const path = require("node:path");

const app = express();
app.disable("x-powered-by");
const PORT = process.env.PORT || 8080;

const PRODUCTS_URL = process.env.PRODUCTS_URL || "http://products:5001";
const CART_URL = process.env.CART_URL || "http://cart:5002";

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => res.json({ status: "ok", tier: "frontend" }));

// Pick the downstream service based on the request path.
function targetFor(reqPath) {
  if (reqPath.startsWith("/api/products")) return PRODUCTS_URL;
  if (reqPath.startsWith("/api/cart") || reqPath.startsWith("/api/visits")) return CART_URL;
  return null;
}

// Minimal reverse proxy.
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

app.listen(PORT, () =>
  console.log(`Frontend on :${PORT} | products -> ${PRODUCTS_URL} | cart -> ${CART_URL}`)
);
