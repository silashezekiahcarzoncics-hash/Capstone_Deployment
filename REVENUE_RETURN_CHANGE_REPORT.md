# SAIPHER CG: merchandise revenue and return reconciliation update

## Scope

This package contains local code and regenerated **local** prepared data only. No production Supabase changes, migration, delete, or sync were performed. **Do not push** this package to production until the remaining seller-funded promotion types and refund source data have been reconciled.

### Changed files

- `server/preparation.js` — requires `Deal Price` in source files; uses `Deal Price × sold Quantity` as merchandise line value; avoids re-deducting the per-line seller price discount already reflected in Deal Price; allocates the **repeated order-level Seller Voucher(PHP) exactly once**, in proportion to merchandise line value within each eligible order. Rejects missing or invalid deal price and invalid sold/returned quantities on eligible records. Retains audit metadata in local prepared rows.
- `server/analytics.js` — a return-approved status with no verified returned units no longer automatically counts as a full return; verified returned units must not exceed sold units. Returned-only quantities and revenue use the same verified returned share.
- `server/analytics.test.js` — additional return-consistency and order-level voucher reconciliation tests.
- `docs/supabase-analytics.md` — updated revenue and return measurement explanation.
- `server/data/prepared_master_data.json` and `server/data/preparation_state.json` — regenerated locally from the included 59 source XLSX files. `readyForAnalysis` is **false** until user review; Supabase is unchanged.

### Reconciliation on uploaded source workbooks

| Metric | Previous local prepared data | Regenerated local prepared data |
| --- | ---: | ---: |
| Prepared rows | 60,457 | 60,457 |
| Eligible rows | 60,302 | 60,302 |
| Gross line merchandise / old buyer-payment amount before returns | ₱17,722,048.00 | ₱17,689,054.00 |
| Revenue net of verified returned-unit shares | ₱17,673,163.00 | ₱17,640,183.05 |
| Eligible row count change | — | 0 |

The change in gross line amounts is ₱32,994.00. This is a local code/data comparison, **not** an independently audited Shopee financial statement or live Supabase comparison.

### Important unresolved business definitions

The source XLSX sheets include additional promotions such as `Seller Bundle Discount(PHP)` and `Coin Cashback Voucher Amount Sponsored by Seller`. Their relationship to `Deal Price` has **not** been independently verified. To avoid double subtraction, the update does **not** deduct those fields as additional discounts. A final verified net-merchandise-revenue figure requires reconciliation of whether those promotions are already embedded in Deal Price or need separate allocation. Order-level Seller Voucher has been treated as an additional seller-funded discount; verify this against actual seller settlement documentation before production use.

Likewise, the provided source format does not establish a reliable line-level **refunded merchandise amount** for status-only returns with unknown returned quantity. Such returns are left unresolved instead of inventing refunded units or money. Refunds without physical product returns require a verified financial refund source to adjust revenue.

### Security and operational notes

- `.env` and secret material are deliberately **not included** in this ZIP. Configure your own server-side `.env` locally; rotate any previously shared Supabase service-role key.
- `node_modules`, Vite caches, build outputs, and Git artifacts are omitted. Run `npm install` on your development machine.
- The backend checks passed locally (`49 passed, 0 failed`). The frontend build could not be completed in this Linux environment because the uploaded `node_modules` contained Windows-specific Rollup packages and lacked `@rollup/rollup-linux-x64-gnu`. Run `npm run build` after `npm install` on your machine.
- After validating the business definitions, review the new Data Preparation output carefully before using any **Push Prepared Data** action. The existing Supabase sync process deletes/replaces records and is **not atomic**; back up the database and address that risk before a production sync.
- Revenue-based forecasts and prescriptive outputs may change once the corrected prepared data is synchronized. Forecasting algorithms are unchanged.
