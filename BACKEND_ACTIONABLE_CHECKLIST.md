# Backend Actionable Checklist (Execution-Only)

**Date:** June 2026  
**Scope:** Calling auth stability, dispatch correctness, serial alignment, unit consistency

---

## P0 — Auth and session consistency

### 1) Calling Data tab APIs

- [ ] `GET /api/dealers/me/calling-queue/next`
- [ ] `GET /api/dealers/me/calling-queue/current`

**Implement:**
- [ ] Accept valid dealer JWT consistently after refresh/tab switch.
- [ ] Return `200` with empty queue payload when no lead exists (not 401/403).
- [ ] Keep role middleware aligned with other dealer dashboard APIs.

**Error contract:**
- [ ] `401` only for invalid/expired/missing token.
- [ ] `403` for valid token but role not allowed.

### 2) Overview/dashboard APIs

- [ ] `GET /api/admin/quotations`
- [ ] `GET /api/admin/statistics` (if used by UI)

**Implement:**
- [ ] Ensure same JWT validation rules as Calling Data flow.
- [ ] Prevent role mismatch where dashboard loads but follow-up API denies with 401.

### 3) Token lifecycle

**Implement:**
- [ ] Verify token is not invalidated unexpectedly after successful actions.
- [ ] Confirm JWT TTL behavior and refresh path.
- [ ] Validate server clock skew tolerance on token verification.

---

## P0 — Dispatch stock deduction and validation alignment

### 4) Dispatch quantity deduction

- [ ] Dispatch handler endpoint(s) in stock request flow

**Implement:**
- [ ] Deduct **dispatch quantity** (`serial_numbers` count per line), not original requested quantity.
- [ ] Prevent `products_quantity_check` failures on partial dispatch.
- [ ] Apply line-by-line quantity checks in multi-item dispatch payloads.

### 5) Serial lookup parity (GET vs POST)

- [ ] GET serial list endpoint(s)
- [ ] POST dispatch endpoint(s)

**Implement:**
- [ ] Use the exact same serial lookup and matching rules in both paths.
- [ ] Match by `product_id` OR normalized `product_name` consistently.
- [ ] Ensure identical eligibility/status filters between fetch and submit.

---

## P1 — Unit consistency for UI labels

### 6) Product and inventory responses

- [ ] `GET /api/products`
- [ ] `GET /api/products/:id`
- [ ] `GET /api/products/inventory-levels`
- [ ] `GET /api/admin-inventory/admin/:adminId`

**Implement:**
- [ ] Always return `unit` for each product/inventory item.
- [ ] Prefer nested `item.product.unit`; include top-level `unit` compatibility alias where needed.
- [ ] Keep stable unit vocabulary (example: `Meters`, `Quantity`, `Pieces`, `Kilograms`) and avoid null/mixed formats.

### 7) Legacy rows backfill

- [ ] Run migration/backfill for null/empty `products.unit`.
- [ ] Verify post-backfill: no null/blank unit in active product rows.

---

## P2 — Calling submit contract

### 8) Calling action submit payload

- [ ] `PATCH /api/dealers/me/calling-queue/:leadId/action`

**Required fields support (camel + snake):**
- [ ] `action`
- [ ] `callRemark` / `call_remark`
- [ ] `statusCategory` / `status_category`
- [ ] `statusText` / `status_text`
- [ ] `nextFollowUpAt`
- [ ] `actionAt`

**Implement:**
- [ ] Auto-assign pool/unassigned lead to current dealer on `start` and submit actions.
- [ ] Remove valid-flow `LEAD_004` by ensuring assignment is persisted before transition.
- [ ] Persist and echo `call_remark` in queue/history responses.

---

## Quick QA pass (must run before release)

- [ ] Valid token + tab switch does not trigger random 401 on Calling/Overview APIs.
- [ ] Role restriction returns 403 (not 401).
- [ ] Partial dispatch (serial count < requested count) succeeds and deducts only dispatched qty.
- [ ] GET serials and POST dispatch accept/reject the same serial set.
- [ ] Units display correctly in Admin Inventory and product lists.
- [ ] Calling remark appears after reload in queue/history and HR/Admin action logs.

---

## Source references

- `BACKEND_TEAM_SUMMARY.md`
- `BACKEND_CHANGES_STOCK_REQUEST_DISPATCH.md`
- `BACKEND_SERIAL_NUMBERS_DISPATCH_FIX.md`
- `BACKEND_CHANGES_QUOTATIONS_B2C_SALES.md`
