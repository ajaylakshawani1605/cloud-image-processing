FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json tsconfig.json prisma.config.ts ./
COPY frontend/package.json frontend/package.json
COPY backend/prisma backend/prisma
RUN --mount=type=cache,id=cloudframe-npm,target=/root/.npm,sharing=locked npm ci --no-audit --no-fund && npm run db:generate
COPY backend/src backend/src
COPY queue-bridge/src queue-bridge/src
RUN npx tsc

FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 openssl && rm -rf /var/lib/apt/lists/* && useradd --uid 1000 --create-home processor
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY worker/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY worker ./worker
ENV NODE_ENV=production PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
USER processor
EXPOSE 3001
CMD ["node", "dist/queue-bridge/src/index.js"]
