# ---- ShopNow Cart service image ----
FROM node:20-alpine

WORKDIR /usr/src/app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

USER node

EXPOSE 5002

HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD wget -qO- http://localhost:5002/health || exit 1

CMD ["node", "server.js"]
