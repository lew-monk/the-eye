# AGENTS.md

## Package Management

Always use **bun** for package management and running scripts:
- `bun add <package>` — install a dependency
- `bun add -d <package>` — install a dev dependency
- `bun run <script>` — run a script from package.json
- `bunx <command>` — run a binary
- Never use `npm` or `yarn`.

## UI Components

Always use components from `@workspace/ui` instead of raw HTML elements for interactive UI. The package exports:

- **Button** — replaces `<button>`. Props: `variant` (default, destructive, outline, secondary, ghost, link, glow), `size` (default, sm, lg, icon), `brackets` (boolean, default true — adds decorative corner brackets), `className`, `asChild`
- **GlassPanel** — section container with frosted glass effect. Props: `variant` (default, elevated, inset), `brackets` (both, top, bottom, none), `padding` (sm, md, lg)
- **HudDialog** — modal dialog in the HUD style. Props: `open`, `onOpenChange`, `title`, `variant` (default, form), `size` (sm, md, lg), `primaryActionLabel`, `onPrimaryAction`, `loading`
- **StatusDot** — small status indicator dot. Props: `variant` (default, success, warning, error, muted), `size` (sm, md, lg), `pulse`
- **StatusChip** — pill-shaped status label. Props: `variant` (default, success, warning, error, secondary, muted), `size` (sm, md)
- **InputField** — styled text input. Props: `label`, `error`, standard input props
- **Form** — form wrapper with validation. Exports: `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage`
- **WeightBar** — horizontal bar showing a weight/relevance percentage. Props: `value` (0-100), `density` (standard, compact), `className`

Example — use this:
```tsx
import { Button } from "@workspace/ui";
<Button variant="ghost" size="sm" brackets={false} className="text-primary/50">
  VIEW_CHUNK →
</Button>
```

Not this:
```html
<button type="button" className="font-mono uppercase tracking-wider ...">
  VIEW_CHUNK →
</button>
```

## API / Data Fetching

The frontend uses tRPC (via `@tanstack/react-query`) to proxy calls to the Elysia backend at `apps/api/`.

- Import tRPC: `import { useTRPC } from "#/integrations/trpc/react";`
- Call queries: `const { data } = useQuery({ ...trpc.procedure.queryOptions(args) });`
- Call mutations: `const mutation = useMutation({ ...trpc.procedure.mutationOptions() });`

For imperative API calls (e.g. inside event handlers), import the raw client:
```tsx
import { apiClient } from "#/lib/api-client";
await apiClient.get<T>("/endpoint");
await apiClient.post<T>("/endpoint", body);
```

## Feature Flags

- `VITE_ENABLE_AUTH` — enables/disables authentication routes and guards

## Styling

- Uses Tailwind CSS with custom design tokens (see `apps/eye-web-app/src/styles.css`)
- Font: monospace throughout
- Key semantic colors: `primary` (teal/cyan), `secondary`, `tertiary`, `muted-foreground`, `on-surface`, `outline-variant`
- Bracket decorations: `bracket-top-left`, `bracket-bottom-right`, `bracket-both` for corner accents

## Backend Routing & Services

### Module Structure

API routes live under `apps/api/src/modules/`. Each module has its own directory with:
- `index.ts` — Elysia router with route definitions (thin handlers, no DB logic)
- `service.ts` — business logic, DB queries, orchestration (abstract class with static methods, or instantiated class)
- `model.ts` — Elysia `t.Object()` validation schemas for request/response bodies

```ts
// apps/api/src/modules/cases/index.ts — routes only, delegate to service
export const casesRouter = new Elysia({ prefix: '/cases' })
  .get('/:id/chunks', async ({ params, set }) => {
    const chunks = await CasesService.getCaseChunks(Number(params.id))
    return { data: chunks }
  })
```

```ts
// apps/api/src/modules/cases/service.ts — DB queries and logic
export abstract class CasesService {
  static async getCaseChunks(caseId: number) { ... }
}
```

### Route Placement

- **Module routes** go in their own directory under `apps/api/src/modules/<module>/index.ts` with the module's `prefix`
- **`modules/index.ts`** aggregates all modules via `.use(moduleRouter)` — only add standalone routes here if they don't belong to an existing module
- **Never** duplicate route parameters at the same path position with different names — Elysia's router will fail if `/cases/:id` and `/cases/:caseId` coexist

### DB Access

- DB queries go in service classes, never directly in route handlers
- Repositories are imported from `@workspace/shared` (`documentRepository`, `caseRepository`, `participantRepository`, `chunkRepository`, etc.)
- Use Drizzle's `eq`, `and`, `or` from `drizzle-orm` for building query conditions

## Agent skills

### Issue tracker

Issues and PRDs live as markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five canonical labels with default names. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context — `CONTEXT-MAP.md` at root maps per-module `CONTEXT.md` files. See `docs/agents/domain.md`.
