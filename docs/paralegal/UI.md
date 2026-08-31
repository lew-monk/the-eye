# Mini-Paralegal: UI Vision

## Brand & Style

**Tactile Tech-Futurism.** The design system is engineered for high-stakes, mission-critical environments where data density and rapid cognitive processing are paramount. It blends the precision of developer tools with the immersive depth of advanced command-and-control interfaces.

The UI evokes absolute control, technical sophistication, and urgency:

- **Military-Grade Precision:** Sharp edges, monospaced typography, technical metadata.
- **Atmospheric Depth:** Multi-layered glass panels and backdrop blurs that create a sense of physical space within the screen.
- **Operational Utility:** Every element is functional; even "decorative" brackets and grid lines serve to ground data points and define spatial relationships.

---

## Colors

Rooted in a "Deep Space" neutral base to maximize contrast and reduce eye strain in low-light environments.

### Surface & Background

| Token | Value | Usage |
|---|---|---|
| `background` | `#111318` | Page background |
| `surface-dim` | `#111318` | Dim surfaces |
| `surface` | `#1e2024` | Default surface |
| `surface-bright` | `#37393e` | Bright/elevated surface |
| `surface-container-lowest` | `#0c0e12` | Deepest container |
| `surface-container-low` | `#1a1c20` | Low container |
| `surface-container` | `#1e2024` | Default container |
| `surface-container-high` | `#282a2e` | High container |
| `surface-container-highest` | `#333539` | Highest container |
| `surface-variant` | `#333539` | Variant surface |

### Text & Borders

| Token | Value | Usage |
|---|---|---|
| `on-surface` | `#e2e2e8` | Primary body text |
| `on-surface-variant` | `#bacac6` | Secondary/muted text |
| `inverse-surface` | `#e2e2e8` | Inverted surface |
| `inverse-on-surface` | `#2f3035` | Text on inverted |
| `outline` | `#849490` | Borders, dividers |
| `outline-variant` | `#3b4a47` | Subtle borders |

### Accents

| Token | Value | Usage |
|---|---|---|
| `primary` | `#4df6e0` | Active data streams, primary CTAs, "Online" status |
| `on-primary` | `#003731` | Text on primary |
| `primary-container` | `#14d9c4` | Container variant |
| `inverse-primary` | `#006b5f` | Inverted primary |
| `surface-tint` | `#23dec9` | Tint/glow |
| `secondary` | `#ffb693` | Alerts, critical warnings, interactive "Hot" zones |
| `on-secondary` | `#561f00` | Text on secondary |
| `secondary-container` | `#fe6b00` | Secondary container |
| `tertiary` | `#d6dcff` | Background data, passive infrastructure labels |
| `on-tertiary` | `#002682` | Text on tertiary |
| `tertiary-container` | `#b1bfff` | Tertiary container |

### Semantic

| Token | Value | Usage |
|---|---|---|
| `error` | `#ffb4ab` | Error states |
| `on-error` | `#690005` | Text on error |
| `error-container` | `#93000a` | Error container |
| `primary-fixed` | `#53fbe5` | Fixed primary |
| `primary-fixed-dim` | `#23dec9` | Dim fixed primary |
| `secondary-fixed` | `#ffdbcc` | Fixed secondary |
| `secondary-fixed-dim` | `#ffb693` | Dim fixed secondary |
| `tertiary-fixed` | `#dde1ff` | Fixed tertiary |
| `tertiary-fixed-dim` | `#b7c4ff` | Dim fixed tertiary |
| `role-judge` | `#f59e0b` | Judge badge |
| `role-lawyer` | `#3b82f6` | Lawyer badge |
| `role-police` | `#ef4444` | Police badge |
| `role-other` | `#966cf6` | Other badge |
| `success` | `#a6ff00` | Optimized/processed status |
| `warning` | `#ffb693` | Stale/outdated status |
| `failed` | `#ff4d4d` | Failed/target status |

Backgrounds use varying opacity (40%–85%) to let the underlying grid and scanline textures bleed through, reinforcing the "HUD" metaphor.

---

## Typography

Exclusively **JetBrains Mono** to maintain a rigorous, technical appearance.

| Style | Font | Size | Weight | Line Ht | Tracking |
|---|---|---|---|---|---|
| `headline-lg` | JetBrains Mono | 32px | 700 | 40px | -0.02em |
| `headline-md` | JetBrains Mono | 24px | 700 | 32px | -0.01em |
| `body-lg` | JetBrains Mono | 16px | 400 | 24px | — |
| `body-sm` | JetBrains Mono | 13px | 400 | 18px | — |
| `label-caps` | JetBrains Mono | 10px | 700 | 12px | 0.1em |
| `data-mono` | JetBrains Mono | 12px | 500 | 14px | — |

Functional roles:
- **Headlines:** Large, bold, often with technical prefixes (`01 // OPERATIONS`)
- **Body:** Clean for dossier descriptions and log entries
- **Labels:** Uppercase, tracked out for metadata like `REF_ID` or `TIMESTAMP`
- **Data Mono:** For numerical grids and code outputs, ensuring vertical alignment

---

## Layout & Spacing

**Fluid High-Density Grid** on a 4px baseline.

| Token | Value |
|---|---|
| `grid-unit` | 4px |
| `gutter` | 16px |
| `margin-page` | 32px |
| `container-padding` | 12px |

- **Nesting:** Large containers = "Command Modules" housing nested "Data Nodes"
- **The Grid:** Subtle 32px background grid visible at all times as alignment guide for floating HUD elements
- **Reflow:** Desktop: 12-column layout with fixed-width sidebars. Mobile: single-column "Vertical Log" view prioritizing most recent data pulses

---

## Elevation & Depth

Depth via **Backdrop-Blur Layers** rather than traditional shadows.

1. **Base Layer** — Tactical grid and visualizations (lowest depth)
2. **Panel Layer** — Semi-transparent containers with `backdrop-filter: blur(12px)` + 1px border
3. **Active Layer** — Interacted elements with brighter border glow (primary) + increased opacity
4. **Overlay Layer** — Modals and critical alerts with scanline texture overlay + high-contrast background

Scanline textures (1px horizontal lines at 5% opacity) applied to all panels to simulate a CRT/high-end sensor display.

---

## Shapes

Sharp (0px border-radius). No rounded corners — maintains rugged, military-industrial feel.

**Data Brackets:** Every primary container features "Bracket Corners" — 1px lines extending 8px from each corner in primary color or 50% opacity neutral white. Crosshair markers (`+`) denote center-point of data modules.

---

## Components

### Buttons
- Rectangular, no radius
- **Primary:** Solid Cyber Teal background (`#4df6e0`) with black text
- **Secondary:** "Ghost" style (1px border) with subtle hover glow
- All buttons include small "Index Number" in top right corner (e.g., `[B1]`)

### Progress Bars & Gauges
- Segmented blocks rather than solid lines — indicates "bits" of data
- Primary color for progress, tertiary for unfilled track

### Input Fields
- Underlined with 1px primary line
- "Focus" bracket appears on left when active
- `label-caps` for all field titles

### Data Chips
- Small rectangular tags for status: `[ SECURED ]` or `[ 09X-ALPHA ]`
- Darker background than parent panel for "cut-out" effect

### Miniature Charts
- Sparklines and mini-histograms stripped of axes and labels
- Glanceable trend lines integrated into list items or header blocks

---

## Animations

- **Engine:** GSAP for all orchestrated animations (orbit rotation, participant entrances, page transitions)
- **Timing:** Smooth, 300–600ms ease-in-out. No glitch, no abrupt transitions
- **Orbit:** Participants rotate slowly around case center (30s per revolution). Hover pauses rotation and highlights connecting lines
- **Pulse:** Relevance scores as pulsing rings — frequency scales with score
- **Entrance:** Staggered fade-in-up for lists, scale-in for cards

---

## Icons

- **Set:** Phosphor icons (`@phosphor-icons/react`)
- **Style:** Regular weight via `weight` prop
- **Common:** `Scale` (judge), `Gavel` (court), `User` (participant), `GitFork` (graph), `ArrowsClockwise` (reprocess), `MagnifyingGlass` (search)

---

## Component Library

- **Primitives:** shadcn/ui, shared via `packages/ui/`
- **Installation:** Each component added with `npx shadcn@latest add <component>` in the UI package
- **Customization:** Theme tokens via `packages/ui/src/globals.css` CSS variables
- **Usage:** Imported from `@workspace/ui` by consumer apps

---

## Views & Layouts

| View | Route | Description |
|---|---|---|
| **Case Detail** | `/cases/:id` | Participant orbit ring around case center, relevance scores as pulsing rings, connecting lines. Top: case header (case number, court, document type, status). Bottom: similar cases carousel |
| **Similar Cases** | `/cases/:id/similar` | Split: left = target case summary with participant ring, right = ranked similar cases with score breakdown bars, shared participants, expand/collapse |
| **Participant Search** | `/participants?name=&role=` | Search bar + results grid. Each card: canonical name, role badge (color-coded), case count, top context snippet |
| **Participant Context** | `/cases/:id/participants/:participantId/context` | Overlay/panel showing every mention with ±100 chars surrounding, highlighted within resolved text. Jump-to-position in document viewer |
| **Graph View** | `/cases/:id/graph` | Full-screen network graph — nodes = cases and participants, edges = shared participants. Drag, zoom, filter by role, cluster by jurisdiction |
| **Re-process Dashboard** | `/admin/reprocess` | Table of documents with extraction/embedding version columns, `outdated` badge when versions mismatch, re-process button per row or batch. Real-time job progress via polling |

---

## Component Tree

### Pages (route-level containers)

```
pages/
  CaseDetailPage        → /cases/:id
  SimilarCasesPage      → /cases/:id/similar
  ParticipantSearchPage → /participants
  GraphPage             → /cases/:id/graph
  ReprocessDashboard    → /admin/reprocess
```

### Feature Components

```
features/
  participants/
    ParticipantRing       — orbit layout around a center point
    ParticipantCard       — avatar/icon + name + role badge + relevance pulse
    ParticipantContextModal
    RoleBadge             — color-coded by role
  similarity/
    SimilarCaseCard       — score bar, breakdown, shared participants list
    ScoreBreakdown        — entity/embedding/metadata bars
  graph/
    NetworkGraph          — full-screen force-directed graph (GSAP + canvas or D3)
  reprocess/
    DocumentTable         — version columns, outdated badges, action buttons
    BatchReprocessBar     — select all, batch re-process
  search/
    ParticipantSearchBar  — input with role filter dropdown
    SearchResultGrid      — grid of ParticipantCards
```

### Shared Primitives (in `packages/ui/`)

```
shared/
  CaseHeader              — case number, court, docket type, status badge
  StatusBadge             — processed / pending / failed / outdated
  DataMetric              — label + value pair for relevance scores, counts
  GlowCard                — card with teal-glow border on hover
  LoadingOrbit            — generic loading spinner styled as orbiting dots
  EmptyState              — centered message for no results
```

---

## Data Flow

### TanStack Query conventions

- **Query keys:** `['cases', id]`, `['cases', id, 'similar', { alpha, beta, gamma }]`, `['participants', { name, role }]`, `['cases', id, 'participants']`, `['cases', id, 'graph']`, `['documents', 'reprocess-status']`
- **Stale time:** 30s default. Graph data: 2min. Reprocess status: 5s polling.
- **Mutations:** re-process enqueue → invalidate document queries.
- **Optimistic updates:** When re-processing a document, immediately show "queued" status.

### Endpoint → View mapping

| Endpoint | Feeds |
|---|---|
| `GET /cases/:id` | CaseDetailPage — case header |
| `GET /cases/:id/similar` | SimilarCasesPage — panel |
| `GET /participants?name=&role=` | ParticipantSearchPage — results |
| `GET /cases/:id/participants` | CaseDetailPage — participant ring |
| `GET /cases/:id/participants/:id/context` | ParticipantContextModal |
| `GET /cases/:id/graph` | GraphPage |
| `POST /internal/documents/reprocess` | ReprocessDashboard — mutation |

---

## Route Structure (Frontend)

```
/cases/:id                          → CaseDetailPage
/cases/:id/similar                  → SimilarCasesPage
/cases/:id/graph                    → GraphPage
/participants                       → ParticipantSearchPage
/admin/reprocess                    → ReprocessDashboard
```

Routes defined in TanStack Router, lazy-loaded via `@tanstack/react-router` file-based routing or manual route definitions.
