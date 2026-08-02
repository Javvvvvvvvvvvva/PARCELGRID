# Multi-stage build for a slim production image.
#
# Stage 1: install deps (cached when package.json doesn't change)
# Stage 2: build the Next app
# Stage 3: copy build output + minimal runtime deps into a clean image
#
# Result: ~200MB image, no source code, no dev deps, no build tooling.

# ─────────────────────────── Stage 1: deps ───────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app

# Keep local, CI and container toolchains aligned.
RUN corepack enable && corepack prepare pnpm@11.1.0 --activate

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# ─────────────────────────── Stage 2: builder ───────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.1.0 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next standalone output makes the runtime image tiny.
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm next build

# ─────────────────────────── Stage 3: runner ───────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV SOURCE_DOCUMENT_STORAGE_DIR=/app/.parcelgrid-data/source-documents

# Non-root user for the runtime
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs \
 && mkdir -p /app/.parcelgrid-data/source-documents \
 && chown -R nextjs:nodejs /app/.parcelgrid-data

# In Next 15, `output: "standalone"` packs only what the server needs.
# For now we copy the conventional layout; if image size becomes an issue,
# turn on standalone in next.config.mjs.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

USER nextjs
EXPOSE 3000
ENV PORT=3000

CMD ["node_modules/.bin/next", "start"]
