FROM node:20-bullseye-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    pkg-config \
    sqlite3 \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
RUN npm ci || npm install

FROM deps AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-bullseye-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV SQLITE_PATH=/app/data/data.sqlite
ENV HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y \
    sqlite3 \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /app/data
VOLUME ["/app/data"]
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Render sets PORT at runtime (e.g., 10000). The Next standalone server
# respects process.env.PORT. EXPOSE is informational only.
EXPOSE 10000
CMD ["node", "server.js"]