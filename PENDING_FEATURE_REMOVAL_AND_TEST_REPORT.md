# SAIPHER CG DSS — Final Data Preparation Cleanup & Test Report

**Date:** 18 November 2026  
**Source:** User-uploaded `SAIPHER_CG_Final (2).zip`  
**Execution:** Tests used temporary local project copies. No Supabase SQL was executed and no remote dataset was changed.

## Implemented changes

1. Removed the **Pending Preparation Changes** dialog, all dedicated frontend state and network requests for it, its backend HTTP route, detailed change-difference function, and stored per-file/per-product change snapshot from the supplied preparation state.
2. Removed `pendingLocalChanges` from published-data API responses, since the feature no longer exists.
3. **Retained one essential safety rule, not the removed feature:** a compact input digest still verifies that the prepared dataset matches current files, categories and mappings. This blocks publication of stale prepared data after an edit. The UI now shows only a simple **Preparation required** status, not a change-history list.
4. Fixed an import/preparation validation mismatch: **Deal Price** is now a required column at import. Completed-order rows with invalid Deal Price, quantities, return quantities or seller voucher values are rejected on import rather than failing unexpectedly during preparation.
5. Fixed a local data-loss hazard: an unreadable or damaged `server/data/database.json` now produces a clear error instead of being treated as an empty database. Metadata file writes use temporary-file replacement to avoid partially written JSON on interruption.
6. Added a helpful empty-import state to Data Preparation, with a link back to Data Management; preparation stays disabled until a valid import exists.
7. Improved first-load wording for large datasets. Added `npm test` to make regression testing repeatable.
8. Preserved the category-only classification system, Live Data read-only behavior, reset buttons, and atomic publication code from the uploaded project.

## Automated regression testing

**67/67 tests passed** using `node --test server/*.test.js`: 55 existing backend analytics, forecasting, live-report and classification tests plus **12 new HTTP integration groups**.

### Explicitly exercised test scenarios

| # | Scenario | Result |
|---|---|---|
| 1 | Backend health endpoint starts with Supabase disabled | PASS |
| 2 | Empty local installation returns zero import counts | PASS |
| 3 | Empty local installation blocks Data Preparation with a useful error | PASS |
| 4 | Removed pending-changes API is no longer available (404) | PASS |
| 5 | Import form with no files | PASS |
| 6 | Wrong-extension upload (`.txt`) is rejected | PASS |
| 7 | Mixed batch: invalid file rejected while a valid workbook is accepted | PASS |
| 8 | Corrupt Excel workbook rejected | PASS |
| 9 | Workbook with the wrong sheet name rejected | PASS |
| 10 | Empty `orders` worksheet rejected | PASS |
| 11 | Missing **Deal Price** column rejected immediately | PASS |
| 12 | Invalid nonnumeric Deal Price rejected | PASS |
| 13 | Negative Deal Price rejected | PASS |
| 14 | Invalid quantity rejected for completed orders | PASS |
| 15 | Returned quantity exceeding sold quantity rejected | PASS |
| 16 | Negative seller voucher rejected | PASS |
| 17 | Duplicate filename (case-insensitive) rejected | PASS |
| 18 | Dataset list and summary contain only accepted imports | PASS |
| 19 | Profile and product classification API return the imported data | PASS |
| 20 | Invalid category assignment rejected | PASS |
| 21 | Valid category assignment reflected immediately in local product data | PASS |
| 22 | Publication blocked when no prepared dataset exists | PASS |
| 23 | First Data Preparation run produces a valid local prepared dataset | PASS |
| 24 | Repeated preparation with unchanged inputs returns same run | PASS |
| 25 | Publishing without explicit confirmation rejected | PASS |
| 26 | Publishing a mismatched run ID rejected | PASS |
| 27 | Category edit marks previously prepared dataset as not current | PASS |
| 28 | Outdated prepared dataset cannot publish | PASS |
| 29 | Running preparation after an edit produces a new run ID | PASS |
| 30 | Add and rename category definitions | PASS |
| 31 | Delete category with assigned products correctly rejected | PASS |
| 32 | Reassign products then delete unused category | PASS |
| 33 | Conflicting order-level seller vouchers cause a controlled preparation failure | PASS |
| 34 | Failed preparation does not overwrite the last good prepared JSON | PASS |
| 35 | Delete offending workbook and rerun successfully | PASS |
| 36 | Delete nonexistent import gives 404 | PASS |
| 37 | Delete imported dataset invalidates preparation and updates summary | PASS |
| 38 | Incorrect reset password rejected | PASS |
| 39 | Live-data request without Supabase credentials reports unavailable, not zero | PASS |
| 40 | Legacy `.xls` workbook import and preparation | PASS |
| 41 | Combined local + Supabase reset is blocked without Supabase configuration, preserving local data | PASS |
| 42 | Local-only reset clears files and preparation state in the disposable test copy | PASS |
| 43 | Corrupted registry is reported (rather than silently replaced) | PASS |
| 44 | Import cannot overwrite an existing corrupted registry | PASS |

### Uploaded full-dataset smoke tests

- **Real input:** 59 ready imported workbooks, 60,464 source lines.
- **Full local Data Preparation:** PASS — 60,457 prepared transactions, 7 exact duplicates, **22 seconds** on this environment; generated JSON was written only to a temporary directory.
- **Read-only HTTP endpoint checks using all original imported files:** 11/11 PASS: datasets, summary, profile, products, geography, status review, return review, duplicate review, time fields, categories, and preparation status.
- The first uncached HTTP profile read took approximately **19.4 seconds**; subsequent cached endpoints responded much faster. The UI keeps a loading indicator during this work.
- **Frontend syntax validation:** 21 JavaScript/JSX source files parsed successfully; no syntax errors.

## Limitations and deployment notes

- **Production Vite build not verified** in the Linux test sandbox because the user's archive includes Windows-only Rollup and esbuild binaries. Attempting to retrieve missing Linux native dependencies failed due unavailable npm registry DNS. Run `npm install` and `npm run build` on your Windows development machine.
- **No hands-on browser click-through** was performed, though backend HTTP routes and frontend syntax were checked.
- **No end-to-end Supabase publication or reset was executed** in this round, deliberately avoiding remote data changes. The existing clone-only database corrections from prior work remain separate.
- There is **no Supabase SQL change for removing Pending Preparation Changes**; no new migration is needed.
- `.env`, `.git`, compiled `dist`, and `node_modules` are excluded from the updated ZIP. Restore your own `.env` privately and install dependencies locally as needed.
- Keep a backup of your imported workbooks and JSON state before replacing a working project copy. Do not point test workflows at the original Supabase database.

### Repeat tests

From project root after installing dependencies:

```bash
npm test
npm run build
```

Run the backend separately on Windows with `npm run server` and the frontend with `npm run dev`.
