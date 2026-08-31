# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root if it exists — it lists every context in the monorepo and points to its `CONTEXT.md`. Read each one relevant to the topic.
- **`CONTEXT.md`** at the repo root (if no `CONTEXT-MAP.md` exists).
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. In multi-context repos, also check per-module `docs/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## File structure

This is a **multi-context monorepo** — contexts live per `apps/` and `packages/` module. The root may also have a `CONTEXT.md` for project-wide domain language.

```
/
├── CONTEXT-MAP.md           ← maps context slugs to CONTEXT.md paths
├── CONTEXT.md               ← (optional) project-wide domain language
├── docs/adr/                ← system-wide architectural decisions
├── apps/
│   ├── api/
│   │   ├── CONTEXT.md       ← API-specific domain language
│   │   └── docs/adr/        ← API-scoped decisions
│   └── eye-web-app/
│       ├── CONTEXT.md       ← Frontend-specific domain language
│       └── docs/adr/        ← Frontend-scoped decisions
└── packages/
    ├── core/
    │   └── CONTEXT.md
    ├── shared/
    │   └── CONTEXT.md
    ├── ui/
    │   └── CONTEXT.md
    └── ...
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
