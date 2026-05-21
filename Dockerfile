# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:22-slim AS builder

# build-essential subset needed to compile better-sqlite3 native addon
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Server ---
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci

COPY server/tsconfig.json ./server/
COPY server/index.ts server/db.ts server/ai.ts server/backup.ts ./server/
RUN cd server && npm run build

# --- Client ---
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci

COPY client/ ./client/
RUN cd client && npm run build

# ── Stage 2: Runner ───────────────────────────────────────────────────────────
FROM node:22-slim AS runner

# ca-certificates — needed for HTTPS calls to Anthropic API
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Production node_modules from builder (includes compiled better-sqlite3 binary)
COPY --from=builder /app/server/node_modules ./server/node_modules
# Compiled server
COPY --from=builder /app/server/dist ./server/dist
# Built client (served statically by Express)
COPY --from=builder /app/client/dist ./client/dist

EXPOSE 3001

CMD ["node", "server/dist/index.js"]
