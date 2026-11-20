# SAIPHER CG DSS — Forecasting Validation & Reliability Update

**Source:** `SAIPHER_CG_Local_Staging_Category_Editor_Fixed.zip` (latest modified project available in this conversation).  
**Scope:** Predictive forecasting / Prescriptive forecast-evidence integration only.  
**Database:** No schema changes, no Supabase calls, no database writes. No SQL required.

## Modified files

- `server/forecasting.js` — chronological independent validation; candidate selection on earlier, non-overlapping forecast-origin windows; causal, training-only adjusted-month interpolation during backtesting; model-specific history checks; zero-safe holdout metrics; uncalibrated-range flag; stricter Prescriptive forecast-growth evidence.
- `server/forecasting.test.js` — repaired formerly ineffective benchmark assertion (`|| true`) and preserved historical regression fixtures while allowing new, accurate validation metadata.
- `server/forecastingValidation.test.js` **(new)** — 14 focused tests for selection leakage, seasonal/forest eligibility, intermittent validation, adjusted-month leakage, zero-safe metrics, numerical model cores, and Prescriptive safeguards.
- `src/pages/PredictiveAnalytics.jsx` — updated model-selection and holdout explanations; labels for non-calibrated ranges and zero-actual MAPE exclusions.
- `src/pages/PrescriptiveAnalytics.jsx` — visible notice when a forecast is exploratory / below benchmark and not used to calculate opportunity-growth evidence.

## Mathematical changes

### Automatic model selection

Previously the system chose ARIMA / Prophet-style / Random Forest by comparing final-holdout errors, then displayed the winning model's error on that *same* holdout. This creates model-selection bias.

Now the process is chronological:
1. Reserve the final 6 months, or 12 months for sufficiently long records, for **independent evaluation**.
2. Select among models by RMSE using **earlier, non-overlapping forecast-origin blocks**, respecting the requested forecasting horizon and common candidate eligibility at the first selection origin.
3. Evaluate the selected model once on the reserved final holdout. This untouched evaluation does **not** influence model selection.
4. Fit the selected model to the available complete history for actual future forecasts, after evaluation.

The three standard model formulas are unchanged; thus fixed-model forecasts and their holdout errors usually stay the same. Auto-assignment *can* change because its selection window is now separate from evaluation.

### Croston SBA / TSB

The intermittent-demand selector now uses an earlier selection window and a separate final six-month holdout when there are at least 24 verified months. Shorter series may still produce clearly labeled **exploratory** forecasts but must not claim independent validation. Values of zero are included in MAE/RMSE; MAPE excludes zero actual values. The Croston SBA / TSB model formulas remain unchanged.

### Missing/adjusted months

Every backtest refits its historical training series using **only the data available before that test origin**. Interpolation of an adjusted month cannot use a future *holdout* observation. Adjusted or unknown test months are not scored; unknown missing months still block a forecast under the existing data-quality rules.

### Eligibility, accuracy and uncertainty

- Model evidence thresholds (observed months): ARIMA 3 (3–6 months may use explicitly labeled random-walk fallback); Prophet-style seasonal regression 24; Random Forest 18; SBA / TSB 12 plus existing nonzero-demand and inactivity rules.
- MAE, RMSE, MAPE, and naive repeat-last-training-month benchmark are calculated on the **same actual test observations**. MAPE excludes actual zeros and reports exclusion count.
- An observation count of at least 24 months, at least 4 scored holdout months, and performance better than the naive baseline are required before ordinary forecasts can be labeled *Validated*. Others remain *Exploratory*, even when an independent holdout is available.
- Forecast upper/lower bands continue to use RMSE/historical spread heuristics. They are marked **uncalibrated**, not 95% prediction intervals. Calibrated statistical coverage was **not** established.

### Prescriptive integration

Only **validated and baseline-beating forecast growth** counts as *forecast-derived growth evidence* for province–category opportunity scoring. Independently supported year-over-year growth may still count. The existing four scoring weights and strategy thresholds are unchanged, but some formerly eligible recommendations can become insufficient when their only growth evidence came from a weak forecast.

## Before / after on the included Shopee data

Test conditions: 60,457 prepared lines, complete months through October 2025, All Available Data, revenue, Strict missing-month handling, 3-month future horizon. Independent final evaluation period: **November 2024–October 2025**. Amounts are in PHP. Rounded for display.

| Method | Previous final-holdout MAE | New final-holdout MAE | New assessment |
|---|---:|---:|---|
| Naive benchmark | 77,535 | 77,535 | Reference |
| ARIMA | 83,427 | 83,427 | Exploratory; did not beat baseline |
| Prophet-style | 105,764 | 105,764 | Exploratory; did not beat baseline |
| Random Forest | 89,087 | 89,087 | Exploratory; did not beat baseline |
| Automatic | Previously chose **ARIMA** from this same final holdout | Now chose **Prophet-style** on earlier selection data, then MAE 105,764 on untouched holdout | Exploratory; did not beat baseline |

**Interpretation:** The validation methodology is now more honest and independent; this is *not evidence of higher forecast accuracy*. The automatic model chosen from earlier months performed worse on this particular later period. Keep this limitation in the capstone evaluation rather than claiming an accuracy increase.

## Testing performed

- **98/98 Node.js automated tests passed**, including existing Data Management, preparation, analytics, revenue/return, geographic, and forecasting regressions and the **14 new mathematical/validation tests**.
- Model-core checks include: a previously captured ARIMA-vs-statsmodels comparison (existing test), known seasonal regression signal, constant-input deterministic forest, hand-calculated Croston SBA and TSB smoothing, zero-safe MAE/RMSE/MAPE, and interval labeling.
- Synthetic histories check: changing only the untouched final holdout does not alter Auto selection; future holdout values cannot alter forecasts at the earlier validation origin across adjusted training months.
- Real Shopee prepared-data comparison conducted before and after against the same included snapshot.
- 45 JS/JSX source files passed Babel parser validation.

### Limitations

- The **Vite production build could not run** in this environment: the Windows-packaged dependencies lack the Linux `@rollup/rollup-linux-x64-gnu` optional binary. Reinstall dependencies on the destination system and run `npm run build` there.
- No real-browser end-to-end workflow, real-time Supabase publication, or current live-data forecast backtest was performed.
- The Prophet-style implementation is a simplified Fourier trend/seasonality regression, **not Meta Prophet**. Random Forest is a deterministic simplified tree ensemble. Reference-library benchmarking for all model variants has not been completed.
- No empirical coverage study for 95% prediction intervals was conducted. Existing forecast ranges are descriptive heuristics.
- The snapshot ends in October 2025; results may differ on newer data and province/category subsets.

## Installation

Replace the old project with the updated ZIP. Restore your existing private `.env` to the project root (not included). Run `npm install` on your machine, then `npm test`, `npm run build`, and restart your backend/frontend. **No new SQL is needed.**
