FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/ui/package.json ./packages/ui/
COPY packages/shared/package.json ./packages/shared/
COPY packages/core/package.json ./packages/core/
COPY packages/workers/package.json ./packages/workers/
COPY apps/api/package.json ./apps/api/
COPY apps/eye-web-app/package.json ./apps/eye-web-app/

COPY . .

RUN bun install --frozen-lockfile
RUN bun run build --filter='@workspace/shared' \
	&& bun run build --filter='@workspace/ui' \
	&& bun run build --filter='@workspace/eye-web-app'

FROM oven/bun:1 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=base /app /app
WORKDIR /app/apps/eye-web-app

EXPOSE 3000
CMD ["bun", "run", "dist/server/server.js"]
