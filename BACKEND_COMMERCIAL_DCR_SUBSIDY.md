# Backend — Commercial DCR/BOTH must NOT require `centralSubsidy` (Jul 2026) — IMPLEMENTED

## Where the validation lived (answer to the handoff question)

The `centralSubsidy is required for dcr and both system types` rule lives in **this repo**, in
**two** places (both now guarded for commercial):

1. **Zod schema refinement** — `validations/quotationValidations.ts`
   - `refineProductsSubsidy()` (runs on `products` for `POST /api/quotations` create and
     `PATCH /api/quotations/:id/products`).
2. **Controller helper** — `validateSubsidyForSystemType()` in the same file, called from
   `updateQuotationProducts` in `controllers/quotationController.ts`.

There is **no** Joi/express-validator schema — it is all Zod + a controller helper.

## What the frontend sends

Commercial flag on the create root, nested `products`, and the pricing PATCH body, in three
interchangeable spellings (any accepted): `pdfCommercialSet`, `pdf_commercial_set`, `isCommercial`.

## Changes made

### 1. Commercial-flag helpers — `utils/quotationProductPdfDisplay.ts`
- `readCommercialFlag(source)` — truthy check for the three spellings on one object.
- `isCommercialRequestBody(body)` — checks root, `products`, and `pricing`.
- `commercialFlagDefinedInBody(body)` — whether the flag is explicitly present (for uncheck).
- `resolveCommercialFlag(body, persistedProducts)` — explicit body flag wins; else persisted.

### 2. Skip the subsidy requirement when commercial — `validations/quotationValidations.ts`
- `refineProductsSubsidy`: the `dcr`/`both` requirement now only fires when
  `!readCommercialFlag(val)`.
- `validateSubsidyForSystemType(..., commercial = false)`: new 4th arg; the requirement only
  fires when `!commercial`.
- Added `isCommercial` to `productsSchemaObject` (alongside `pdfCommercialSet` /
  `pdf_commercial_set`).

### 3. Force subsidy to 0 and don't deduct — `controllers/quotationController.ts`
- **Create** (`finalPricing`): when `isCommercialRequestBody(req.body)`, `centralSubsidy`,
  `stateSubsidy`, `totalSubsidy` = `0` and `amountAfterSubsidy = subtotal` (no 78000 backfill).
- **Pricing PATCH** (`updatePricing`): when `resolveCommercialFlag(req.body, currentProducts)`,
  subsidies forced to `0`; `amountAfterSubsidy = subtotal - totalSubsidy` (totalSubsidy = 0).
- **Products PATCH** (`updateQuotationProducts`): passes the resolved commercial flag into
  `validateSubsidyForSystemType`.

### 4. Persist + round-trip the flag
- Create: `pdfCommercialSet` persists via the existing `products` JSONB flow (same as
  `pdfPanelRangeKey`) and is returned by `quotationProductPdfDisplayApiFields`.
- Pricing PATCH: now also persists `pdfCommercialSet` on the `QuotationProduct` when the flag is
  present in the body (accepts `false` to clear).

## Acceptance
1. DCR commercial create with `centralSubsidy: 0` → 201, no `VAL_SUBSIDY`.
2. Stored `centralSubsidy = 0`, `stateSubsidy = 0`, `totalSubsidy = 0`.
3. `amountAfterSubsidy === subtotal`; `finalAmount === subtotal - discount`.
4. Non-commercial DCR/BOTH with `centralSubsidy: 0` → still rejected.
5. `GET` returns `pdfCommercialSet: true` inside `products`.
