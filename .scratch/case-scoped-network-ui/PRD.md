# PRD: Case-scoped Network UI (picker → single-case network)

## Status
Implemented on branch `feat/case-scoped-network-ui` (branched from `main`).
- `apps/eye-web-app/src/components/case-picker.tsx` (new): search + per-case `OPEN_NETWORK →` rows, `NO_CASES_ONBOARD` / `NO_MATCHES` empty states, `CASE_NOT_FOUND` notice.
- `apps/eye-web-app/src/routes/network.tsx`: no `cases[0]` fallback/auto-navigate; picker renders when no focus (zero network queries, no `GraphWorld` mount); `← ALL_CASES` resets trail/working/burst state; in-sidebar ALL CASES section removed; `NetworkBoard` `viewMode` type fixed (`"board" | "list"`).
- Verification: web-app vitest 48/48 pass; `tsc` error count 95 vs 96 on `main` (fixed the `viewMode` mismatch, no new errors); biome check blocked by pre-existing nested-config conflict.

## Problem
The `/network` page (`apps/eye-web-app/src/routes/network.tsx`) auto-selects the first case on load (`network.tsx:149-155`) and immediately fetches + renders its full network:

- `cases.list` → auto-navigate to `cases[0]` → `getFocusNetwork` + `getCaseRelations` + `getEntityMentionContexts`
- mounts `IsoNetworkScene` → lazy `GraphWorld` (three.js) eagerly
- `mergeConnectedCases` + `unionGraph(working)` + `filterCoreGraph` run on every selection

There is no all-cases aggregate query today (backend is already per-focus: `GET /network/focus` in `apps/api/src/modules/index.ts:24-54` dispatching to `CaseNetworkService.getFocusNetwork` for `case|entity|document|role`, plus `GET /cases/:id/network`). The compute risk the user names is therefore about UX direction, not an existing endpoint: we must not introduce a "network of all onboarded cases", and we should stop auto-loading a heavy 3D graph before the user picks a case.

## Goal
`/network` becomes a two-state, case-scoped flow:

1. **Case picker (default, cheap):** list of onboarded cases from the existing `cases.list` query only. No network fetch, no `GraphWorld` mount.
2. **Single-case network (on demand):** existing board/list + inspector experience, scoped to the selected `caseId`, with deep-link preserved.

Explicit non-goal: no global / multi-case graph endpoint, no cross-case union, no prefetch of other cases' networks.

## Current behavior (evidence)
- Auto-redirect: `network.tsx:149-155` — if no `?focus=`/`?caseId=`, navigates to `cases[0]`.
- Network fetch gated only on `activeFocus != null` (`network.tsx:157-164`); since `activeFocus` falls back to `cases[0]?.id` (`network.tsx:147`), the heavy query fires on first paint whenever any case exists.
- Sidebar mixes "CASES ON THE BOARD" (graph nodes) with "ALL CASES" (`network.tsx:372-397`), so the picker is buried inside the heavy view.
- Cost centers per case: `CaseNetworkService.getCaseNetwork` (`apps/api/src/modules/cases/network.ts:8-155`, per-doc `participantRepository.findByDocumentId` loop + `entityCap=24`), role/entity views (`network-views.ts`), client `filterCoreGraph` caps (`graph-relevance.ts:51-59`).

## Proposed UX
- `GET /network` with no `caseId` → full-page picker:
  - Search input (client-side filter on `caseNumber`/`title`), status chip, `OPEN_NETWORK →` action per row.
  - Uses `trpc.cases.list` (`casesRouter GET /`, limit 100, `apps/api/src/modules/cases/index.ts:50-75`). No other query fires.
  - Empty state: `NO_CASES_ONBOARD` + link to case creation / upload.
- Selecting a case → `navigate({ search: { caseId, focus: case:<id> } })` → network view:
  - Existing header stats (`SHOWN/HIDDEN/CONNECTIONS`), `BOARD_VIEW/LIST_VIEW`, `BURST_ALL`, inspector `ENTITY/CONNECTIONS` tabs unchanged.
  - New `← ALL_CASES` button: clears `trail`, `working`, `burst/burstIds`, `selectedId`; navigates back to picker search state.
- Deep links (`/network?caseId=12&focus=case:12`, entity/doc/role focuses) keep working: if `caseId` present, skip picker and load directly. Invalid `caseId` → picker with `CASE_NOT_FOUND` notice.
- In-network "ALL CASES" section is removed from the sidebar (it duplicates the picker and encourages confusion); cross-case navigation stays via `connected_case` nodes → `goInside`/`expandNode` (explicit, user-initiated, folded into `working` graph only).

## Technical plan
1. `apps/eye-web-app/src/routes/network.tsx` — split `NetworkPage`:
   - Parse search as today (`caseId?`, `focus?`).
   - `selectedCaseId = search.caseId ?? null` (drop the `cases[0]` fallback + auto-navigate effect).
   - If `selectedCaseId == null` → render `<CasePicker cases, isLoading, onSelect>`; return early so `getFocusNetwork`, `getCaseRelations`, `getEntityMentionContexts`, `filterCoreGraph`, `IsoNetworkScene` never mount.
   - Else render existing board (extract to `<CaseNetworkBoard caseId>` or keep inline) with all existing queries gated on `enabled: selectedCaseId != null`.
   - `selectCase` and `← ALL_CASES` reset `trail/working/burst/burstIds/selectedId`.
2. New `apps/eye-web-app/src/components/case-picker.tsx` (presentational, `@workspace/ui` `Button/InputField/GlassPanel/StatusChip` per AGENTS.md — no raw `<button>`):
   - Props: `cases, isLoading, value, onChange, onSelect`.
   - Client-side filter + count; keyboard accessible; `OPEN_NETWORK →` per row.
3. Keep `IsoNetworkScene` lazy as-is (`iso-network.tsx:7-9`); verify it only mounts in network state (React Suspense `LOADING_WORLD` fallback unchanged).
4. Keep backend untouched. Picker reuses `cases.list`; network reuses `getFocusNetwork` (`entityCap=24`), relations, mention contexts. No new endpoint.
5. Guards to preserve perf:
   - No `queryClient.prefetchQuery` / `fetchQuery` for unselected cases (audit `expandNode` — it stays user-initiated single-node only).
   - Keep `CORE_CAPS` + `filterCoreGraph` behavior; `BURST_ALL` remains opt-in.
   - `staleTime: 30s` on `cases.list` stays; network queries keep default caching.

## Acceptance criteria
- [ ] Cold load `/network` with N cases fires `cases.list` only (verified in devtools: no `/network/focus`, no `/relations`, no three.js chunk until selection).
- [ ] Picker search filters by number/title; Enter/click opens that case's network via `?caseId=&focus=case:`.
- [ ] Network view shows only the selected case's graph; header stats + board/list toggle + inspector + burst/expand behave as today.
- [ ] `← ALL_CASES` returns to picker without stale graph state (switching cases never shows previous case's nodes).
- [ ] Deep link with valid `caseId` loads directly; invalid/unknown `caseId` falls back to picker with notice.
- [ ] Zero cases → `NO_CASES_ONBOARD` empty state, no error, no focus query.
- [ ] `bun run check` / `tsc` clean; no new raw interactive HTML elements (uses `@workspace/ui`).

## Test plan
- Manual: 0 cases, 1 case, many cases; select → back → select another; deep-link entity/doc/role focus; burst + expand + trail still scoped to one case.
- Existing: `apps/api/src/modules/cases/network.test.ts` (no backend change expected, run to confirm).
- Network tab audit before/after to prove no extra `/network/focus` calls from picker.

## Rollout
- Single PR from `feat/case-scoped-network-ui` → `main`, frontend-only. No migration, no env change.
- Follow-up ideas (out of scope): picker metadata (doc/entity counts per case), pagination beyond 100 cases, recent-cases ordering.
