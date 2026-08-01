/**
 * Backend handoff helpers — Crompton DCR set (1-Phase) — Aug 2026
 *
 * Full spec: BACKEND_CROMPTON_DCR_SET.md
 * Wire into: validateProductSelection, products PATCH/GET, pricing-tables JSON, set-price lookup.
 *
 * Package identity (do not coerce):
 *   panelType === "Crompton set" (package marker)
 *   panelBrand / dcrPanelBrand === "Premier Energy"
 *   inverterBrand === "Crompton", inverterSize === "3.6kW"
 *   acdb / dcdb === "Crompton (1-Phase)"
 *   pdfPanelRangeKey === "premier_energy_600_610" (600W–610W Topcon Bifacial)
 *   prices: 3kW/1-Phase → 210000, 5kW/1-Phase → 295000
 */

export const CROMPTON_DCR_SET_NAME = "Crompton set"
export const CROMPTON_INVERTER_BRAND = "Crompton"
export const CROMPTON_INVERTER_SIZE = "3.6kW"
export const CROMPTON_PDF_PANEL_RANGE_KEY = "premier_energy_600_610"

export const DCR_CROMPTON_SET_PRICES: ReadonlyArray<{
  systemSize: string
  phase: "1-Phase"
  inverterSize: string
  panelType: string
  price: number
  notes: string
}> = [
  {
    systemSize: "3kW",
    phase: "1-Phase",
    inverterSize: CROMPTON_INVERTER_SIZE,
    panelType: CROMPTON_DCR_SET_NAME,
    price: 210_000,
    notes: "Premier Energy 600W–610W panels; Crompton 3.6kW inverter + ACDB/DCDB",
  },
  {
    systemSize: "5kW",
    phase: "1-Phase",
    inverterSize: CROMPTON_INVERTER_SIZE,
    panelType: CROMPTON_DCR_SET_NAME,
    price: 295_000,
    notes: "Premier Energy 600W–610W panels; Crompton 3.6kW inverter + ACDB/DCDB",
  },
]

export const DCR_CROMPTON_SYSTEM_CONFIGS = [
  {
    systemType: "dcr" as const,
    systemSize: "3kW",
    phase: "1-Phase" as const,
    panelBrand: CROMPTON_DCR_SET_NAME,
    panelSize: "610W",
    inverterBrand: CROMPTON_INVERTER_BRAND,
    inverterSize: CROMPTON_INVERTER_SIZE,
    inverterType: "String Inverter",
    structureType: "GI Structure",
    structureSize: "3kW",
    meterBrand: "L&T",
    acCableBrand: "Polycab",
    acCableSize: "As per Set",
    dcCableBrand: "Polycab",
    dcCableSize: "As per Set",
    acdb: "Crompton (1-Phase)",
    dcdb: "Crompton (1-Phase)",
    centralSubsidy: 78_000,
  },
  {
    systemType: "dcr" as const,
    systemSize: "5kW",
    phase: "1-Phase" as const,
    panelBrand: CROMPTON_DCR_SET_NAME,
    panelSize: "610W",
    inverterBrand: CROMPTON_INVERTER_BRAND,
    inverterSize: CROMPTON_INVERTER_SIZE,
    inverterType: "String Inverter",
    structureType: "GI Structure",
    structureSize: "5kW",
    meterBrand: "L&T",
    acCableBrand: "Polycab",
    acCableSize: "As per Set",
    dcCableBrand: "Polycab",
    dcCableSize: "As per Set",
    acdb: "Crompton (1-Phase)",
    dcdb: "Crompton (1-Phase)",
    centralSubsidy: 78_000,
  },
]

type ProductsLike = {
  systemType?: string
  phase?: string
  systemSize?: string
  panelBrand?: string
  dcrPanelBrand?: string
  panelType?: string
  panel_type?: string
  inverterBrand?: string
  inverterSize?: string
  pdfPanelRangeKey?: string
  pdf_panel_range_key?: string | null
  acdb?: string
  dcdb?: string
}

function norm(v?: string | null): string {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
}

/** True when quotation products are the Crompton DCR package. */
export function isCromptonDcrSet(p: ProductsLike): boolean {
  if (String(p.systemType || "").trim().toLowerCase() === "non-dcr") return false
  const brand = norm(p.panelBrand || p.dcrPanelBrand)
  const panelType = norm(p.panelType || p.panel_type)
  const range = norm(p.pdfPanelRangeKey || p.pdf_panel_range_key)
  const inverter = norm(p.inverterBrand)
  return (
    brand === "crompton set" ||
    panelType === "crompton set" ||
    panelType.includes("crompton") ||
    range === CROMPTON_PDF_PANEL_RANGE_KEY ||
    (brand === "premier energy" && inverter === "crompton")
  )
}

/**
 * Allowlist check for validateProductSelection — call before rejecting unknown brands.
 * Returns null when OK; otherwise a short rejection reason.
 */
export function validateCromptonDcrProducts(p: ProductsLike): string | null {
  if (!isCromptonDcrSet(p)) return null

  if (norm(p.phase) && norm(p.phase) !== "1-phase") {
    return "Crompton set is 1-Phase only"
  }

  const invBrand = String(p.inverterBrand || "").trim()
  if (invBrand && norm(invBrand) !== "crompton") {
    return `Crompton set expects inverterBrand "${CROMPTON_INVERTER_BRAND}"`
  }

  const invSize = String(p.inverterSize || "").trim()
  if (invSize && norm(invSize) !== "3.6kw") {
    // Soft warning path: still allow if pricing lookup uses package price by panelType
    // Prefer accepting 3.6kW; do not hard-fail other sizes if set price already applied.
  }

  return null
}

/** Set price for Crompton DCR package, or null if not this package / unknown size. */
export function getCromptonDcrSetPrice(systemSize: string, phase?: string): number | null {
  if (phase && norm(phase) !== "1-phase") return null
  const size = String(systemSize || "").trim()
  const row = DCR_CROMPTON_SET_PRICES.find((r) => r.systemSize === size)
  return row ? row.price : null
}

/**
 * Merge into pricing-tables `dcr` array (idempotent by systemSize+phase+panelType).
 */
export function mergeCromptonDcrPricingRows<T extends { systemSize: string; phase: string; panelType: string }>(
  existing: T[],
): Array<T | (typeof DCR_CROMPTON_SET_PRICES)[number]> {
  const out = [...existing]
  for (const row of DCR_CROMPTON_SET_PRICES) {
    const idx = out.findIndex(
      (r) =>
        r.systemSize === row.systemSize &&
        r.phase === row.phase &&
        r.panelType === row.panelType,
    )
    if (idx >= 0) out[idx] = { ...out[idx], ...row }
    else out.push(row)
  }
  return out
}

/**
 * Merge Crompton presets into systemConfigurations (idempotent by type+size+brand+phase).
 */
export function mergeCromptonSystemConfigs<T extends Record<string, unknown>>(existing: T[]): T[] {
  const out = [...existing]
  for (const cfg of DCR_CROMPTON_SYSTEM_CONFIGS) {
    const idx = out.findIndex(
      (c) =>
        c.systemType === cfg.systemType &&
        c.systemSize === cfg.systemSize &&
        c.panelBrand === cfg.panelBrand &&
        c.phase === cfg.phase,
    )
    if (idx >= 0) out[idx] = { ...out[idx], ...cfg } as T
    else out.push(cfg as unknown as T)
  }
  return out
}

/** Example: keep Premier Energy brand + Crompton set marker on save. */
export function preserveCromptonSetIdentity<T extends ProductsLike>(products: T): T {
  if (!isCromptonDcrSet(products)) return products
  return {
    ...products,
    panelBrand: "Premier Energy",
    dcrPanelBrand: "Premier Energy",
    panelType: CROMPTON_DCR_SET_NAME,
    inverterBrand: products.inverterBrand?.trim() || CROMPTON_INVERTER_BRAND,
    inverterSize: products.inverterSize?.trim() || CROMPTON_INVERTER_SIZE,
    acdb: products.acdb?.trim() || "Crompton (1-Phase)",
    dcdb: products.dcdb?.trim() || "Crompton (1-Phase)",
    pdfPanelRangeKey:
      products.pdfPanelRangeKey?.trim() ||
      String(products.pdf_panel_range_key || "").trim() ||
      CROMPTON_PDF_PANEL_RANGE_KEY,
  }
}

/**
 * Set-price resolver: use Crompton prices when panelType is Crompton set.
 * Do NOT price plain Premier Energy / Premier Energies under this table.
 */
export function resolveDcrSetPriceForProducts(p: ProductsLike & { systemSize?: string }): number | null {
  if (!isCromptonDcrSet(p)) return null
  const size = String(p.systemSize || "").trim()
  return getCromptonDcrSetPrice(size, p.phase)
}
