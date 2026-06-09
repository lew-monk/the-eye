# The Eye

A bun workspace monorepo with shadcn styling.

## Structure

```
the-eye/
├── apps/
│   ├── api/          # Backend API (Elysia)
│   └── web/          # Frontend (React + Vite)
├── packages/
│   ├── core/         # OCR Service (Azure DI + BullMQ)
│   ├── ui/           # Shared UI components (shadcn)
│   └── shared/       # Shared utilities and types
└── package.json      # Workspace configuration
```

## Development

Install dependencies:
```bash
bun install
```

Run all services:
```bash
bun run dev
```

Build all packages:
```bash
bun run build
```

## Services

- **Web**: http://localhost:3000
- **API**: http://localhost:3001

## Deployment

### Docker

#### Development (with hot reload)

For development with live reloading and volume mounts:

```bash
# Start development environment
docker-compose -f docker-compose.dev.yml up --build

# Run in background
docker-compose -f docker-compose.dev.yml up -d --build

# Stop development services
docker-compose -f docker-compose.dev.yml down
```

#### Production

For production deployment:

```bash
# Start production environment
docker-compose -f docker-compose.prod.yml up --build

# Run in background
docker-compose -f docker-compose.prod.yml up -d --build

# Stop production services
docker-compose -f docker-compose.prod.yml down
```

**Note**: The old `docker-compose.yml` and `docker-compose.infrastructure.yml` files have been combined into `docker-compose.dev.yml` and `docker-compose.prod.yml` for better organization.

### Manual Docker Build

```bash
# Build web app
docker build -f apps/web/Dockerfile -t the-eye-web .

# Build API
docker build -f apps/api/Dockerfile -t the-eye-api .

# Run containers
docker run -p 3000:80 the-eye-web
docker run -p 3001:3001 the-eye-api
```# the-eye
