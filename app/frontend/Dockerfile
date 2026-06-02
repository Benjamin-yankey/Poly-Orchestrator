# ---- ShopNow Frontend image ----
FROM node:20-alpine

WORKDIR /usr/src/app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY public ./public

USER node

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD wget -qO- http://localhost:8080/health || exit 1

CMD ["node", "server.js"]
