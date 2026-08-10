# Backend: Pricing tables (Admin Pricing + dealer PDF)

**Priority:** HIGH  
**Status:** Frontend ready — backend must implement GET + PUT  
**Date:** 8 Aug 2026

---

## Goal

1. **`GET /api/quotations/pricing-tables`** — return DB package prices (DCR / Non-DCR / BOTH + components).  
2. **`PUT /api/quotations/pricing-tables`** — **admin only**; persist edits from Admin → **Pricing**.  
3. Dealers use GET for New Quotation browse configs + Calling Data **Download pricing PDF**.

**FE source / seed:** `lib/pricing-tables.ts` → [`BACKEND_PRICING_TABLES_SEED.json`](BACKEND_PRICING_TABLES_SEED.json)  
**Helpers:** [`BACKEND_PRICING_TABLES_SEED.ts`](BACKEND_PRICING_TABLES_SEED.ts)  
**Copy-paste handlers:** [`BACKEND_PRICING_TABLES_CONTROLLER.ts`](BACKEND_PRICING_TABLES_CONTROLLER.ts)  
**Legacy GET detail:** [`BACKEND_PRICING_TABLES_API.md`](BACKEND_PRICING_TABLES_API.md)

---

## Frontend behavior (what backend must support)

| Admin action | What happens |
|--------------|----------------|
| Edit price / fields | Draft only in browser |
| **Add** row (DCR / Non-DCR / BOTH) | Confirm dialog → append blank row to draft |
| **Delete** row | Confirm dialog → remove from draft |
| **Save to backend** | Confirm dialog → **`PUT`** with **full** payload including **`dcr` + `nonDcr` + `both`** |

Add/Delete do **not** call the API. Only Save persists. After Save, the next **GET** must return the saved arrays (including empty arrays if admin deleted all rows of a type).

Client: `api.quotations.updatePricingTables(body)` → `PUT /api/quotations/pricing-tables` with JSON body = pricing object (root keys, not wrapped unless you also accept `{ data: … }`).

---

## Storage (recommended)

```sql
CREATE TABLE IF NOT EXISTS pricing_config (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);
```

Seed once from `BACKEND_PRICING_TABLES_SEED.json` (normalize with `normalizePricingTablesPayload`).

---

## Endpoints

### GET `/api/quotations/pricing-tables`

| | |
|--|--|
| Auth | Dealers, admins, visitors |
| Response | `{ "success": true, "data": { "dcr": [...], "nonDcr": [...], "both": [...], "panels": [...], "inverters": [...], "structures": [...], "meters": [...], "cables": [...], "acdb": [...], "dcdb": [...], "systemConfigs": [...] } }` |
| Empty DB | Auto-seed from JSON **or** return seed file contents |

Use key **`systemConfigs`** (map legacy `systemConfigurations` → `systemConfigs` on read).

### PUT `/api/quotations/pricing-tables`

| | |
|--|--|
| Auth | **Admin only** → else `403` `{ success:false, error:{ code:"AUTH_403", … } }` |
| Body | Full or partial top-level keys. Admin Save sends **all three**: `dcr`, `nonDcr`, `both` (arrays). May also include component arrays + `systemConfigs`. |
| Persist | For each key present as an **array** in the body, **replace** that array in storage (do not append). Keep unspecified keys from existing row. |
| Validate | Each `dcr` / `nonDcr` / `both` row: `systemSize`, `panelType` non-empty; `price` finite number. BOTH rows also have `dcrCapacity`, `nonDcrCapacity`. |
| Response | `{ "success": true, "data": <saved payload> }` — same shape as GET `data` |
| Errors | `400 VAL_001` validation · `403 AUTH_403` · `500 PRICING_002` |

#### Example PUT body (truncated)

```json
{
  "dcr": [
    { "systemSize": "3kW", "phase": "1-Phase", "inverterSize": "3kW", "panelType": "Adani", "price": 186000 },
    { "systemSize": "3kW", "phase": "1-Phase", "inverterSize": "3kW", "panelType": "Waaree Topcon", "price": 190000 }
  ],
  "nonDcr": [
    { "systemSize": "3kW", "phase": "1-Phase", "inverterSize": "3kW", "panelType": "Adani", "price": 145000 }
  ],
  "both": [
    {
      "systemSize": "5kW",
      "phase": "3-Phase",
      "inverterSize": "5kW",
      "dcrCapacity": "3kW",
      "nonDcrCapacity": "2kW",
      "panelType": "Adani",
      "price": 270000
    }
  ],
  "panels": [],
  "inverters": [],
  "structures": [],
  "meters": [],
  "cables": [],
  "acdb": [],
  "dcdb": [],
  "systemConfigs": []
}
```

---

## Seed counts (current FE snapshot)

| Key | Rows | Notes |
|-----|------|--------|
| `dcr` | ~97 | Incl. **Waaree Topcon** 610W, Adani / Topcon / Waaree, Premier, INA, Tata, Crompton set |
| `nonDcr` | ~39 | Incl. 80kW Renew Energy / Waaree / Adani |
| `both` | ~36 | DCR + Non-DCR packages |
| `systemConfigs` | ~110 | Browse presets |

Validity display: **2026-08-04 → 2026-08-31**

After FE catalog changes, regenerate JSON (see command in older section / repo root one-liner) and re-seed or UPDATE `pricing_config`.

---

## Spot-checks

`assertAug2026DcrSeed(data.dcr)` from `BACKEND_PRICING_TABLES_SEED.ts` — must pass after seed.

Smoke:

1. GET returns Waaree Topcon rows.  
2. Admin changes a Non-DCR price → Save → GET shows new price.  
3. Admin deletes a BOTH row → Save → GET both.length decreased.  
4. Non-admin PUT → 403.  
5. Dealer Calling Data PDF / New Quotation DCR dialog use GET prices.

---

## Checklist

- [x] `pricing_config` table (or equivalent) — `system_config.pricing_tables`
- [x] Seed from `BACKEND_PRICING_TABLES_SEED.json`
- [x] `GET /api/quotations/pricing-tables`
- [x] `PUT /api/quotations/pricing-tables` admin-only; replaces `dcr` / `nonDcr` / `both` when sent
- [x] Echo saved payload on PUT response + subsequent GET
- [x] Spot-checks + smoke above
- [x] Wire handlers (`configController` + `BACKEND_PRICING_TABLES_CONTROLLER.ts` reference)
