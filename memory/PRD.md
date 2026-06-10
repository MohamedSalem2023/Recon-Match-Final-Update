# ReconMatch — PRD

## Original Problem Statement (Arabic)
في احيان كثيرة اثناء تسجيل العمليات البنكية ممكن نسجل حركات الـ POS هو ضا عن إننا نسجلها حركة حركة، ودا لأن معروف إن حركات الـ POS حركات كتير فتسهيلاً بنسجلها كحركة واحدة كل يوم بالتةتال، وبالمثل حركات العمولات البنكية. فهل نقدر نضيف الميزة دي للبرنامج بحيث لما يجي يطابق يراعي حاجة زي كدا.

User confirmation iterations:
- Sample file: System sheet (52 rows, ledger - aggregated daily entries) vs Bank sheet (377 rows, individual POS settlements).
- One day in System may have 1-3 aggregated entries (e.g., "Collection From POS" + "Collections From POS") each matching a different SUBSET of bank rows on the same date.
- Requirement: stronger algorithm that auto-finds subsets without manual setup.

## Architecture
- Stack: Vite + React 19 + TypeScript on Express (single port 3000), in-process reconciliation service.
- Key files:
  - `src/types.ts` — domain types.
  - `src/services/reconciliation.ts` — matching engine (subset-sum, fuzzy, exact).
  - `src/components/MappingPage.tsx` — settings UI.
  - `src/components/ResultsPage.tsx` — results UI.
  - `server.ts` — Express + Vite middleware.

## What's Been Implemented (Jan 2026)

### v1: Initial Daily Aggregation (keyword-based)
- Added settings + UI toggle, summed by keyword per day.
- INSUFFICIENT for real data because users couldn't configure keywords/side reliably.

### v2: Robust date parser
- Parses Excel serial, native Date, ISO (YYYY-MM-DD), DD/MM/YYYY, MM/DD/YYYY, with manual hint + auto-detect.
- Fixes the silent bug where "01/05/2026" was being read as Jan-5 instead of May-1.

### v3 (current): Bilateral Subset-Sum (ENABLED BY DEFAULT)
- Replaces the keyword-only daily aggregation with a powerful **subset-sum** matcher:
  - For each entry on the aggregated side, finds ANY subset of detail-side rows on the same day whose amounts sum to it within `amountTolerance` (default 0.01).
  - **Single-row preference**: tries 1:1 exact-amount match first, so a single bank row matching a single ledger row isn't swept into a larger subset.
  - **Bilateral**: runs in BOTH directions (A→B and B→A) per side (debit / credit). User no longer needs to pre-pick which dataset is aggregated.
  - **Per-day grouping**: smallest aggregated entries processed first so 1:1 matches consume their counterparts before larger entries claim them.
  - Branch-and-bound DFS with prefix-sum pruning, capped at 2M steps for safety.
- **Default ON**: `enableDailyAggregation: true` and `enableSubsetSum: true` out of the box.
- UI clarifies the bilateral behaviour and removed the now-redundant "Aggregated side" picker.
- Optional **keyword filter** is still available (off by default) to narrow candidate pool when needed.

## Verified Behaviour (against user's real Sample.xlsx, May 2026, 377 bank + 52 system rows)
- 52/52 System entries matched (100%).
- 374/377 Bank rows matched (99%). The 3 unmatched rows are 0-amount fee/transfer rows unrelated to POS settlements (correct behaviour).
- 0 adjustments needed.
- Works regardless of column orientation (Bank as A or B), with auto date format, with trailing-space column names (`مبلغ الإيداع `).
- Day 01/05/2026: Match 1 = single 9,741.25 row (1:1), Match 2 = 6 bank rows summing to 96,243.54 (subset-sum). ✓

## Prioritized Backlog
- P2: Show daily subset details inline in Results page (the 6 rows that summed to 96,243.54) — currently visible via JSON export.
- P2: Polish PDF/Excel export to label `daily-aggregate` matches more prominently and group by day.
- P3: Provide a "Near-miss adjustments" pass when subset-sum can't find an exact match (suggest the closest combo with delta).

## Next Tasks
- Verify Save-to-Github flow + user re-tests with their fresh export.
