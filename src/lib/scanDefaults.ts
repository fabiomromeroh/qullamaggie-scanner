/**
 * Stage-1 Yahoo-screener universe floor (fallback path only).
 * The $5 / 100K-share / $20M dollar-volume rules are client-side UI toggles
 * (`src/lib/liquidityFilters.ts`), not this floor.
 *
 * Env overrides: `SCAN_MIN_PRICE`, `SCAN_MIN_AVG_VOL`, `SCAN_STAGE1_CAP`.
 * Tooltips cite these defaults and do not read the live environment.
 *
 * Price ≥ $1 and avg vol ≥ 100K is the loosest practical Yahoo EquityQuery
 * floor: STAGE1_CAP still caps the list (default 800) and page count is
 * unchanged, so loosening further would not add names beyond the cap and
 * would only swap high-volume names for thinner ones. Do not drop this floor
 * without raising the cap — an unfiltered US-equity screen explodes the
 * request budget.
 */
export const SCAN_MIN_PRICE_DEFAULT = 1
export const SCAN_MIN_AVG_VOL_DEFAULT = 100_000
export const SCAN_STAGE1_CAP_DEFAULT = 800
export const SCAN_STAGE1_PAGE_SIZE = 250
