# Backend — Non-DCR 80kW set (Renew Energy / Waaree / Adani) — Jul 2026

**Frontend (already shipped):**
- `lib/pricing-tables.ts` — Non-DCR 80kW set prices + presets (Vsole/Xwatt)
- `lib/quotation-pdf-display.ts` — PDF panel range keys
- `lib/quotation-proposal-document.ts` — ≥20kW ACDB/DCDB → **CT / BT** (“As per the set”)
- `components/product-selection-form.tsx` — auto-selects PDF range on 80kW Non-DCR package pick

**Related:** HANDOFF §2.1 (PDF panel range keys), `GET /quotations/pricing-tables`, `utils/defaultPricingTables.ts`

---

## Product summary

| Item | Value |
|------|--------|
| System | **Non-DCR**, **80kW**, **3-Phase**, inverter **Vsole/Xwatt** **80kW** |
| Renew Energy set price | **₹25,10,000** |
| Waaree set price | **₹25,90,000** |
| Adani set price | **₹25,90,000** |
| Renew Energy panel range (PDF) | **600W - 630W** |
| Waaree panel range (PDF) | **580W - 630W** |
| Adani panel range (PDF) | **600W - 630W** |
| ≥20kW PDF distribution labels | Component **CT / BT**; brand **As per the set** (frontend-only) |

Panel brand string must be **`Renew Energy`** (not `RenewSys`) for this package.

---

## Checklist

| # | Item | Status |
|---|------|--------|
| 1 | Persist + echo new `pdfPanelRangeKey` values | **Done** (`PDF_PANEL_RANGE_KEYS`) |
| 2 | Allow `panelBrand` **`Renew Energy`** (no coerce to Adani / RenewSys) | **Done** (`DEFAULT_PANEL_BRANDS`) |
| 3 | Allow Non-DCR **80kW** + inverter **80kW** | **Done** (size checks soft; catalog sizes include 630W) |
| 4 | `GET /quotations/pricing-tables` includes 80kW Non-DCR rows + presets | **Done** |
| 5 | Do not reject empty / “As per the set” ACDB·DCDB | **Done** (`isAsPerTheSet` skip) |

---

## A) PDF panel range keys

| Key | Brand | PDF label |
|-----|--------|-----------|
| `renew_energy_600_630` | Renew Energy | 600W - 630W |
| `waaree_580_630` | Waaree | 580W - 630W |
| `adani_600_630` | Adani | 600W - 630W |

**Code:** `utils/quotationProductPdfDisplay.ts` → `PDF_PANEL_RANGE_KEYS` / `PDF_PANEL_RANGE_LABELS`  
**Zod:** `validations/quotationValidations.ts` (imports enum)  
**Swagger:** `config/swagger.ts`

### Persist example

```json
{
  "pdfPanelRangeKey": "renew_energy_600_630",
  "pdf_panel_range_key": "renew_energy_600_630",
  "pdfUsePanelSizeRange": true,
  "panelBrand": "Renew Energy",
  "panelSize": "600W",
  "inverterBrand": "Vsole/Xwatt",
  "inverterSize": "80kW",
  "systemType": "non-dcr",
  "phase": "3-Phase"
}
```

Rules (HANDOFF §2.1):
- Accept on `PATCH /quotations/{id}/products` (+ create).
- Echo on every GET list/detail.
- Empty string / null clears the key.
- When range key is set, `panelQuantity` may be `0` — do not 400.

---

## B) Pricing tables

`GET /api/quotations/pricing-tables` (and `GET /api/config/pricing`) merges defaults from `utils/defaultPricingTables.ts`.

### `data.nonDcr[]` (80kW rows)

| systemSize | phase | inverterSize | panelType | price |
|------------|-------|--------------|-----------|-------|
| 80kW | 3-Phase | 80kW | Renew Energy | 2510000 |
| 80kW | 3-Phase | 80kW | Waaree | 2590000 |
| 80kW | 3-Phase | 80kW | Adani | 2590000 |

### `data.systemConfigurations` presets

| panelBrand | panelSize | inverterBrand | inverterSize |
|------------|-----------|---------------|--------------|
| Renew Energy | 600W | Vsole/Xwatt | 80kW |
| Waaree | 580W | Vsole/Xwatt | 80kW |
| Adani | 600W | Vsole/Xwatt | 80kW |

---

## C) Example PATCH

```http
PATCH /api/quotations/{id}/products
Authorization: Bearer <dealer|admin>
Content-Type: application/json
```

```json
{
  "systemType": "non-dcr",
  "phase": "3-Phase",
  "panelBrand": "Renew Energy",
  "panelSize": "600W",
  "panelQuantity": 0,
  "inverterBrand": "Vsole/Xwatt",
  "inverterSize": "80kW",
  "inverterType": "String Inverter",
  "structureType": "GI Structure",
  "structureSize": "80kW",
  "acdb": "Havells (3-Phase)",
  "dcdb": "Havells (3-Phase)",
  "pdfPanelRangeKey": "renew_energy_600_630",
  "pdfUsePanelSizeRange": true,
  "centralSubsidy": 0,
  "stateSubsidy": 0
}
```

Same pattern for Waaree (`waaree_580_630`, price **2590000**) and Adani (`adani_600_630`, **2590000**).

---

## D) PDF CT / BT (≥20kW)

Frontend-owned. Backend only persists products + range keys + pricing. No `CT`/`BT` API field required.

---

## E) QA

1. Save Non-DCR **80kW Renew Energy** → GET: `panelBrand: "Renew Energy"`, `pdfPanelRangeKey: "renew_energy_600_630"`, subtotal **2510000**.
2. Waaree / Adani with their keys + prices.
3. Soft refresh: ranges + brand still present.
4. Uncheck PDF range → PATCH empty key → GET null/absent.
5. No **400** on `Renew Energy`, `80kW`, or new range keys.
6. `GET /quotations/pricing-tables` includes the three 80kW `nonDcr` rows.
