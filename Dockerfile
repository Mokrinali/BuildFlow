# syntax=docker/dockerfile:1

# ── base ─────────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# OpenSSL is needed by the Prisma schema engine used for migrations.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ── deps: full install (postinstall runs `prisma generate`) ─────────────────
FROM base AS deps
# prisma.config.ts requires DATABASE_URL to exist; no database is contacted at build time.
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# ── build ────────────────────────────────────────────────────────────────────
FROM deps AS build
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY . .
RUN npm run build

# ── tools: migrations and admin scripts (full toolchain) ────────────────────
FROM build AS tools
ENV NODE_ENV=production
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

# ── runner: minimal production server ───────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
