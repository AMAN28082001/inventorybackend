# Backend — Non-DCR Waaree 125kW set (Aug 2026)

**Frontend (live):** Browse NON DCR → **125kW (3-Phase) · Waaree · ₹35,62,500**  
**Code:** `lib/pricing-tables.ts` · `lib/quotation-data.ts` · `lib/use-product-catalog.ts`  
**Related:** `BACKEND_NON_DCR_80KW.md`, `BACKEND_PRICING_TABLES_API.md`

---

## Product summary

| Item | Value |
|------|--------|
| System | **Non-DCR**, **125kW**, **3-Phase** |
| Panel brand | **Waaree** |
| Default panel size (preset) | **580W** (user may change, e.g. **705W**) |
| Inverter | **Vsole/Xwatt** **125kW** |
| Structure | **GI Structure** **125kW** |
| Set price | **₹35,62,500** (`3562500`) |
| Subsidy | **0** (Non-DCR) |

PDF: selected wattage must be returned/persisted as-is (e.g. **705W**). Do not rewrite to 615W on the API.

---

## Checklist

| # | Item | Status |
|---|------|--------|
| **N1** | Add Non-DCR pricing row to `GET/PUT /quotations/pricing-tables` → `nonDcr[]` | **Done** |
| **N2** | Add system config preset for Waaree 125kW → `systemConfigs[]` / `systemConfigurations` | **Done** |
| **N3** | Product catalog: allow **`125kW`** on inverters + structures | **Done** |
| **N4** | Product catalog: allow panel size **`705W`** | **Done** |
| **N5** | Create / `PATCH …/products` accept `125kW` + `705W` without 400 | **Done** |
| **N6** | Echo fields on GET; keep selected wattage (no rewrite to 615W) | **Done** |

---

## A) Pricing table row

### `data.nonDcr[]`

```json
{
  "systemSize": "125kW",
  "phase": "3-Phase",
  "inverterSize": "125kW",
  "panelType": "Waaree",
  "price": 3562500
}
```

### `data.systemConfigs[]` (preset)

```json
{
  "systemType": "non-dcr",
  "systemSize": "125kW",
  "phase": "3-Phase",
  "panelBrand": "Waaree",
  "panelSize": "580W",
  "inverterBrand": "Vsole/Xwatt",
  "inverterSize": "125kW",
  "inverterType": "String Inverter",
  "structureType": "GI Structure",
  "structureSize": "125kW",
  "meterBrand": "L&T",
  "acCableBrand": "Polycab",
  "acCableSize": "As per Set",
  "dcCableBrand": "Polycab",
  "dcCableSize": "As per Set",
  "acdb": "Havells (3-Phase)",
  "dcdb": "Havells (3-Phase)"
}
```

`GET /quotations/pricing-tables` **injects** this row if the stored JSON is older (same for `systemConfigs`).  
`PUT` / Admin Save also merge it in (does not drop other rows).

Migration `20260817160000-add-non-dcr-waaree-125kw-pricing.js` writes the row into live `system_config.pricing_tables`.

---

## B) Product catalog allowlists

`GET /quotations/product-catalog` and `GET /config/products` merge defaults:

| Path | Add |
|------|-----|
| `panels.sizes` | **`705W`** (also `700W`, `640W`, …) |
| `inverters.sizes` | **`125kW`** |
| `structures.sizes` | **`125kW`** |

Validation also allows free-text `\d+W` so **705W** is never rewritten to **615W**.

---

## C) Quotation products example

```http
PATCH /api/quotations/{id}/products
Authorization: Bearer <dealer|admin>
Content-Type: application/json
```

```json
{
  "systemType": "non-dcr",
  "phase": "3-Phase",
  "panelBrand": "Waaree",
  "panelSize": "705W",
  "panelQuantity": 177,
  "inverterBrand": "Vsole/Xwatt",
  "inverterSize": "125kW",
  "inverterType": "String Inverter",
  "structureType": "GI Structure",
  "structureSize": "125kW",
  "meterBrand": "L&T",
  "acCableBrand": "Polycab",
  "acCableSize": "As per Set",
  "dcCableBrand": "Polycab",
  "dcCableSize": "As per Set",
  "acdb": "Havells (3-Phase)",
  "dcdb": "Havells (3-Phase)",
  "centralSubsidy": 0,
  "stateSubsidy": 0,
  "systemPrice": 3562500
}
```

Persist **`panelSize: "705W"`** exactly. Proposal PDF uses the stored wattage (Topcon Bifacial label is FE-only).

---

## D) QA

1. `GET /quotations/pricing-tables` → `nonDcr` contains Waaree **125kW** @ **3562500**.
2. Browse NON DCR on FE shows the set without relying only on FE merge.
3. Create quotation: Waaree 125kW, change panel to **705W** → save succeeds.
4. GET products → `panelSize: "705W"`, `inverterSize: "125kW"`, price/subtotal **3562500**.
5. Proposal PDF shows **705W Topcon Bifacial** (not 615W).

---

## Shipped in this repo

| File | Change |
|------|--------|
| `BACKEND_PRICING_TABLES_SEED.json` | `nonDcr` + `systemConfigs` Waaree 125kW |
| `utils/defaultPricingTables.ts` | Fallback row + GET/PUT inject if missing |
| `utils/defaultProductCatalog.ts` | `705W`, `125kW` inverter/structure sizes |
| `utils/productCatalogNormalize.ts` | Merge those defaults; allow `\d+W` |
| `database/migrations/20260817160000-add-non-dcr-waaree-125kw-pricing.js` | Live DB merge |

```bash
yarn migrate
```
