# Cloud Run 控制面 — Node 22 slim、非 root
FROM node:22-slim
WORKDIR /app
COPY control-plane/package.json ./
COPY control-plane/package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY control-plane/src ./src
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "src/server.ts"]
