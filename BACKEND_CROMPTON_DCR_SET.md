# Backend handoff — Crompton DCR set (1-Phase) — Aug 2026

**Frontend (already shipped):**
- `lib/pricing-tables.ts` — DCR browse column **`Crompton set`**, set prices, presets (Crompton inverter / ACDB / DCDB)
- `lib/quotation-pdf-display.ts` — PDF range key `premier_energy_600_610` → **600W - 610W Topcon Bifacial**
- `lib/quotation-api-payload.ts` — persists `panelBrand: "Premier Energy"` + `panelType: "Crompton set"`; restores on GET
- `components/product-selection-form.tsx` — form shows **Premier Energy** + checked PDF range + Crompton ACDB/DCDB

**Related:** `BACKEND_PRICING_TABLES_API.md`, HANDOFF §2.1 / §2.3 / **§27**, `GET /quotations/pricing-tables`  
**Copy-paste helpers:** `BACKEND_CROMPTON_DCR_SET.ts`

---

## Product summary

| Item | Value |
|------|--------|
| System | **DCR**, **1-Phase only** |
| Package / pricing column | **`Crompton set`** (browse `panelType`; keep as `products.panelType`) |
| Form panel brand | **`Premier Energy`** |
| Panels | **Premier Energy** within **600W–610W Topcon Bifacial** (typical pick **610W**) |
| Inverter | **Crompton** **3.6kW** |
| ACDB / DCDB | **Crompton (1-Phase)** |
| 3kW set price | **₹2,10,000** |
| 5kW set price | **₹2,95,000** |
| PDF panel range key | **`premier_energy_600_610`** → label **600W - 610W Topcon Bifacial** |
| Central subsidy | Same DCR default (**₹78,000**) unless commercial PDF flag |

**Not in this set:** 3-Phase Crompton rows, Non-DCR Crompton / Premier Energy package prices.

---

## Checklist — backend must deliver

| # | Item |
|---|------|
| 1 | Persist + echo `pdfPanelRangeKey` / `pdf_panel_range_key` = **`premier_energy_600_610`** |
| 2 | Allow `panelBrand` = **`Premier Energy`** (catalog brand — may be new) |
| 3 | Persist + echo `panelType` / `panel_type` = **`Crompton set`** (package marker — **required for set price**) |
| 4 | Allow `inverterBrand` = **`Crompton`**, `inverterSize` = **`3.6kW`** |
| 5 | Allow ACDB/DCDB **`Crompton (1-Phase)`** |
| 6 | Accept panel sizes **`600W` / `605W` / `610W`** with normal qty (> 0) |
| 7 | Set-price when `panelType === "Crompton set"`: **3kW→210000**, **5kW→295000** — do **not** use Premier Energies Topcon matrix |
| 8 | If serving `GET /quotations/pricing-tables`, include Crompton DCR rows + system presets |
| 9 | Empty range key on PATCH clears stored key (same as §2.1) |

---

## A) PDF panel range key

| Key | Package | PDF label |
|-----|---------|-----------|
| `premier_energy_600_610` | Crompton set | 600W - 610W Topcon Bifacial |

Also still valid: existing Waaree / Adani / Premier Topcon / Tata / INA / 80kW Non-DCR keys.

### Persist fields (example 3kW)

```json
{
  "systemType": "dcr",
  "phase": "1-Phase",
  "panelBrand": "Premier Energy",
  "dcrPanelBrand": "Premier Energy",
  "panelType": "Crompton set",
  "panelSize": "610W",
  "dcrPanelSize": "610W",
  "panelQuantity": 5,
  "dcrPanelQuantity": 5,
  "inverterType": "String Inverter",
  "inverterBrand": "Crompton",
  "inverterSize": "3.6kW",
  "structureType": "GI Structure",
  "structureSize": "3kW",
  "acdb": "Crompton (1-Phase)",
  "dcdb": "Crompton (1-Phase)",
  "pdfPanelRangeKey": "premier_energy_600_610",
  "pdf_panel_range_key": "premier_energy_600_610",
  "pdfUsePanelSizeRange": true,
  "centralSubsidy": 78000
}
```

### Example 5kW

```json
{
  "systemType": "dcr",
  "phase": "1-Phase",
  "panelBrand": "Premier Energy",
  "panelType": "Crompton set",
  "panelSize": "610W",
  "panelQuantity": 8,
  "inverterBrand": "Crompton",
  "inverterSize": "3.6kW",
  "structureSize": "5kW",
  "acdb": "Crompton (1-Phase)",
  "dcdb": "Crompton (1-Phase)",
  "pdfPanelRangeKey": "premier_energy_600_610",
  "centralSubsidy": 78000
}
```

**Rules (same as HANDOFF §2.1):**
- Accept keys on `PATCH /quotations/{id}/products` (and create flow).
- Echo on every GET list/detail.
- Empty string / null clears the key.
- Do **not** rewrite `panelType: "Crompton set"` away, or remap `Premier Energy` → `Premier Energies` for this package.

---

## B) DCR pricing table / set prices

If `GET /api/quotations/pricing-tables` (or equivalent) is live, include:

```json
{
  "dcr": [
    {
      "systemSize": "3kW",
      "phase": "1-Phase",
      "inverterSize": "3.6kW",
      "panelType": "Crompton set",
      "price": 210000,
      "notes": "Premier Energy 600W–610W panels; Crompton 3.6kW inverter + ACDB/DCDB"
    },
    {
      "systemSize": "5kW",
      "phase": "1-Phase",
      "inverterSize": "3.6kW",
      "panelType": "Crompton set",
      "price": 295000,
      "notes": "Premier Energy 600W–610W panels; Crompton 3.6kW inverter + ACDB/DCDB"
    }
  ]
}
```

**Lookup notes:**
- Match primarily on `systemSize` + `phase` + `panelType === "Crompton set"`.
- Inverter on the package is fixed **3.6kW** for both 3kW and 5kW slabs — do not require `inverterSize === systemSize`.
- Frontend also falls back to hardcoded `lib/pricing-tables.ts` when API is missing rows.

---

## C) System configuration presets

Include in `systemConfigurations` (or `systemConfigs`):

```json
[
  {
    "systemType": "dcr",
    "systemSize": "3kW",
    "phase": "1-Phase",
    "panelBrand": "Crompton set",
    "panelSize": "610W",
    "inverterBrand": "Crompton",
    "inverterSize": "3.6kW",
    "inverterType": "String Inverter",
    "structureType": "GI Structure",
    "structureSize": "3kW",
    "meterBrand": "L&T",
    "acCableBrand": "Polycab",
    "acCableSize": "As per Set",
    "dcCableBrand": "Polycab",
    "dcCableSize": "As per Set",
    "acdb": "Crompton (1-Phase)",
    "dcdb": "Crompton (1-Phase)",
    "centralSubsidy": 78000
  },
  {
    "systemType": "dcr",
    "systemSize": "5kW",
    "phase": "1-Phase",
    "panelBrand": "Crompton set",
    "panelSize": "610W",
    "inverterBrand": "Crompton",
    "inverterSize": "3.6kW",
    "inverterType": "String Inverter",
    "structureType": "GI Structure",
    "structureSize": "5kW",
    "meterBrand": "L&T",
    "acCableBrand": "Polycab",
    "acCableSize": "As per Set",
    "dcCableBrand": "Polycab",
    "dcCableSize": "As per Set",
    "acdb": "Crompton (1-Phase)",
    "dcdb": "Crompton (1-Phase)",
    "centralSubsidy": 78000
  }
]
```

Optional catalog component rows (if product catalog is validated strictly):

| Table | Brand | Size / phase |
|-------|-------|----------------|
| panels | Premier Energy | 600W, 605W, 610W |
| inverters | Crompton | 3.6kW |
| acdb / dcdb | Crompton | 1-Phase |

---

## D) Validation — do / don’t

**Do accept:**
- `panelBrand` / `dcrPanelBrand`: `Premier Energy`
- `panelType`: `Crompton set`
- `inverterBrand`: `Crompton`
- `inverterSize`: `3.6kW`
- `acdb` / `dcdb`: `Crompton (1-Phase)`
- `pdfPanelRangeKey`: `premier_energy_600_610`
- DCR `systemSize` `3kW` / `5kW` with phase `1-Phase` only for this package

**Do not:**
- Drop `panelType: "Crompton set"` or remap this package to the Premier Energies Topcon price column
- Reject `3.6kW` because it is not `3kW` or `5kW`
- Require 3-Phase Crompton set rows (none exist)
- Treat this as Non-DCR

**Distinguish from existing Premier Energies DCR column** (Topcon 600–625 package prices) — different `panelType` (`Crompton set` vs `Premier Energies`) and different PDF range (`premier_energy_600_610` vs `premier_600_625_bifacial_topcon`).

---

## E) Pricing / subtotal

When quotation uses Crompton set package prices (browse select or matching products):

| systemSize | phase | Expected set / subtotal basis |
|------------|-------|-------------------------------|
| 3kW | 1-Phase | **210000** |
| 5kW | 1-Phase | **295000** |

Frontend sends computed `subtotal` / `systemPrice` from the selected config; backend should not overwrite with Adani/Premier Energies matrix prices when **`panelType === "Crompton set"`** (form `panelBrand` is **`Premier Energy`**).

**Lookup order for set price:**
1. If `panelType` / `panel_type` is `Crompton set` → use Crompton set prices (210000 / 295000)
2. Else if `panelBrand` is Premier Energies / Premier → existing Premier Energies matrix
3. Never treat plain `Premier Energy` alone as Crompton set unless `panelType` / Crompton inverter + `premier_energy_600_610` also match

---

## QA

1. DCR Browse → **Crompton set** 3kW → save → GET echoes `panelBrand: "Premier Energy"`, `panelType: "Crompton set"`, `inverterBrand: "Crompton"`, `inverterSize: "3.6kW"`, `acdb`/`dcdb` Crompton, `pdfPanelRangeKey: "premier_energy_600_610"`, subtotal **210000**.
2. Same for 5kW → subtotal **295000**.
3. Edit/reload form shows **Panel Brand = Premier Energy**, PDF range checkbox **600W - 610W Topcon Bifacial** checked, ACDB/DCDB Crompton (not remapped to Premier Energies set price).
4. Uncheck PDF range → PATCH empty key → GET has no stale range.
5. If pricing-tables API is on: response `dcr` includes both Crompton set rows; presets include both system configs.
6. Existing Premier Energies / Tata / INA DCR packages unchanged.

---

## Frontend note (until catalog allowlists ship)

If live `validateProductSelection` still rejects unknown brands/sizes, allowlist:
- **`Premier Energy`** (panel brand)
- **`Crompton set`** (`panelType`)
- **`Crompton`** (inverter + ACDB/DCDB)
- **`3.6kW`**
- **`premier_energy_600_610`**

Preferred over aliasing to Adani / Premier Energies (that would break package identity and set price on GET).

Reference source of truth in repo: `lib/pricing-tables.ts` (`CROMPTON_DCR_SET_NAME`, `DCR_CROMPTON_SET_PRICING_ROWS`), `lib/quotation-api-payload.ts` (`restoreCromptonSetForForm`).
