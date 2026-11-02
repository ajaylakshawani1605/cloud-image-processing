FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json tsconfig.json prisma.config.ts ./
COPY frontend/package.json frontend/package.json
COPY backend/prisma backend/prisma
RUN --mount=type=cache,id=cloudframe-npm,target=/root/.npm,sharing=locked npm ci --no-audit --no-fund && npm run db:generate
COPY backend/src backend/src
COPY queue-bridge/src queue-bridge/src
RUN npx tsc
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["sh", "-c", "npm run db:migrate && node dist/backend/src/server.js"]
