FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY frontend/package.json frontend/package.json
RUN --mount=type=cache,id=cloudframe-npm,target=/root/.npm,sharing=locked npm ci --no-audit --no-fund
COPY frontend ./frontend
RUN npm run build -w frontend
FROM nginx:1.28-alpine
COPY infrastructure/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
