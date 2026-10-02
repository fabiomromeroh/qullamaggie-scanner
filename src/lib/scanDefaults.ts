/**
 * Stage-1 screener defaults. The server reads env overrides at startup
 * (`SCAN_MIN_PRICE`, `SCAN_MIN_AVG_VOL`, `SCAN_STAGE1_CAP`); these are the
 * values used when those variables are unset. Tooltips cite these defaults
 * and do not read the live environment.
 */
export const SCAN_MIN_PRICE_DEFAULT = 5
export const SCAN_MIN_AVG_VOL_DEFAULT = 750_000
export const SCAN_STAGE1_CAP_DEFAULT = 800
export const SCAN_STAGE1_PAGE_SIZE = 250
