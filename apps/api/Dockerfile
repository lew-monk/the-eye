# Use the official Bun image
FROM oven/bun:1 AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json bun.lock ./
COPY packages/ui/package.json ./packages/ui/
COPY packages/shared/package.json ./packages/shared/
COPY packages/core/package.json ./packages/core/
COPY apps/api/package.json ./apps/api/

# Install dependencies
RUN bun install --frozen-lockfile

# Build the shared packages
FROM deps AS builder
WORKDIR /app

# Copy source code
COPY . .

# Build shared packages first
RUN bun run build --filter='@workspace/shared'
RUN bun run build --filter='@workspace/ui'
RUN bun run build --filter='@workspace/core'

# Build the API
RUN bun run build --filter='@workspace/api'

# Production image
FROM base AS runtime
WORKDIR /app

# Copy built packages and API
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/ui/dist ./packages/ui/dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/

# Install only production dependencies for API
RUN cd apps/api && bun install --production --frozen-lockfile

# Switch to non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs
USER nodejs

EXPOSE 3003

CMD ["bun", "run", "./apps/api/dist/index.js"]
