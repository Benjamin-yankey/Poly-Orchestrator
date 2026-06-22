# ---- ShopNow Frontend image (multi-stage) ----

# Stage 1: build the Angular SPA.
FROM node:20-alpine AS web-build
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build
# Angular outputs to dist/web/browser (application builder).

# Stage 2: lightweight runtime — Express server + the proxy + the built SPA.
FROM node:20-alpine
# Patch base-image OS packages (e.g. openssl/libssl3/libcrypto3) to the latest
# Alpine security fixes — clears the ECR scan's OpenSSL CVEs (3.5.6-r0 -> 3.5.7-r0).
RUN apk upgrade --no-cache
WORKDIR /usr/src/app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY --from=web-build /build/web/dist/web/browser ./public

USER node

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD wget -qO- http://localhost:8080/health || exit 1

CMD ["node", "server.js"]
