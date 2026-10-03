# Quality gates — `packages/ingestion`

One documented analyzer per gate (per plan §3). Full Stryker/mutation runs
nightly in CI; per-PR gates are lint + typecheck + coverage + complexity.

| Gate | Analyzer / enforcement |
|---|---|
| Cyclomatic < 22 / fn | keep functions small; orchestrator delegates to pure seams |
| Cognitive < 22 / fn | same — pure `policy.ts` / `filters.ts` seams |
| < 500 lines / file | split fakes/fixtures out of prod files |
| 100% stmt/branch/fn/line (in scope) | `bun test --coverage` |
| No dead code | `noUnusedLocals` / `noUnusedParameters` in tsconfig |
| No `any` / `unknown` leaks | `strict` + no `any` in prod code; narrow once at seams |

Complexity strategy: deep typed modules + narrow ports; the orchestrator
delegates to pure seams so each function stays small and every branch is
unit-testable (see `tests/` — every test hunts a real bug class).
