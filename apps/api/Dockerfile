# Development Dockerfile for hot reload
FROM oven/bun:1 AS base

WORKDIR /app

# Copy config files for path mapping
COPY tsconfig.json ./
# COPY packages/ui/tsconfig.json ./packages/ui/
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/core/tsconfig.json ./packages/core/
COPY packages/workers/tsconfig.json ./packages/workers/
COPY apps/api/tsconfig.json ./apps/api/

# Copy package files
COPY package.json bun.lock ./
# COPY packages/ui/package.json ./packages/ui/
COPY packages/shared/package.json ./packages/shared/
COPY packages/core/package.json ./packages/core/
COPY packages/workers/package.json ./packages/workers/
COPY package.json ./apps/api/

# Copy source code
COPY . .

# Install dependencies and build shared packages
RUN bun install && bun run build --filter='@workspace/shared' && bun run build --filter='@workspace/core' && bun run build --filter='@workspace/workers'

# Web development stage
FROM base AS web-dev
EXPOSE 3000
WORKDIR /app/apps/web

# API development stage
FROM base AS api-dev
EXPOSE 3001
WORKDIR /app/apps/api
