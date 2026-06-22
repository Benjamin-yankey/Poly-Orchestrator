# ---- ShopNow Products service image ----
FROM node:20-alpine

# Patch base-image OS packages (e.g. openssl/libssl3/libcrypto3) to the latest
# Alpine security fixes — clears the ECR scan's OpenSSL CVEs (3.5.6-r0 -> 3.5.7-r0).
RUN apk upgrade --no-cache

WORKDIR /usr/src/app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js auth.js capabilities.js ./

USER node

EXPOSE 5001

HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD wget -qO- http://localhost:5001/health || exit 1

CMD ["node", "server.js"]
