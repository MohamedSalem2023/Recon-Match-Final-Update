# ReconMatch — PRD

## Original Problem Statement (Arabic)
في احيان كثيرة اثناء تسجيل العمليات البنكية ممكن نسجل حركات الـ POS هو ضا عن إننا نسجلها حركة حركة، ودا لأن معروف إن حركات الـ POS حركات كتير فتسهيلاً بنسجلها كحركة واحدة كل يوم بالتةتال، وبالمثل حركات العمولات البنكية. فهل نقدر نضيف الميزة دي للبرنامج بحيث لما يجي يطابق يراعي حاجة زي كدا.

## Architecture
- Stack: Vite + React 19 + TypeScript on Express (single port 3000), in-process reconciliation service.
- Key files:
  - `src/types.ts` — domain types.
  - `src/services/reconciliation.ts` — matching engine.
  - `src/components/MappingPage.tsx` — settings UI.
  - `src/components/ResultsPage.tsx` — results UI.
  - `server.ts` — Express + Vite middleware.

## Core Requirements
- Compare two datasets (e.g., Ledger vs Bank statement) and produce matches, adjustments, and unmatched lists.
- Support multiple matching strategies: exact (by identifier or amount+date), one-to-many, fuzzy.
- NEW: Daily aggregation matching for cases where one side records POS / bank commissions as a single daily total while the other side lists every transaction individually.

## What's Been Implemented (Jun 2026)
- **Daily Aggregation feature** (this iteration):
  - New settings: `enableDailyAggregation`, `aggregationKeywords`, `aggregationSide`.
  - New matching step runs before fuzzy: for each aggregated-side record matching a keyword (in description/reference), sum all keyword-matching records on the detail side on the same date (within date tolerance) and:
    - if sums equal → register as `daily-aggregate` match (subtype of combined)
    - if sums differ → register as adjustment (`Daily {Debit|Credit} Aggregate (yyyy-mm-dd)`) with the proper difference, still removing the involved rows from the unmatched pool.
  - UI: dedicated section in `MappingPage` under Matching Settings with enable toggle, side selector (A/B), and keywords textarea pre-filled with common Arabic/English POS & commission keywords.
  - Default keywords: `POS, نقاط بيع, نقطة بيع, عمولة, عمولات, مصاريف بنكية, رسوم, commission, fees`.
  - Results page: added a teal badge for `daily-aggregate` match type.
- Backwards-compatible: when `enableDailyAggregation = false`, behaviour is unchanged.

## Verified Behaviour (via API tests)
- 2 aggregated POS daily totals (1500 & 2000) matched against 5 detailed bank POS rows → 2 `daily-aggregate` matches + a normal exact match for the unrelated salary row, 100% matched.
- Sum mismatch (1500 ledger vs 1200 bank) → produced an adjustment with difference -300 and removed rows from unmatched lists.
- Feature disabled → original behaviour preserved.

## Prioritized Backlog
- P1: Visually display the aggregated sub-items in ResultsPage when expanding a `daily-aggregate` adjustment (currently stored under `__aggregated` marker).
- P2: Excel/PDF exports — make sure new `daily-aggregate` type prints nicely.
- P2: Add per-keyword group reporting (POS vs Commissions split) if user later wants distinct categories.

## Next Tasks
- Optional: enrich the adjustments rendering to expand `__aggregated` items.
- Optional: surface a small inline help/example in the new settings panel.
