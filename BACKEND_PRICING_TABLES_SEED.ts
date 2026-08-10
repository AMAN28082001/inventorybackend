/**
 * Backend handoff — Pricing tables seed + GET/PUT (Aug 2026)
 *
 * Source of truth for the initial DB payload:
 *   - Frontend: `lib/pricing-tables.ts`
 *   - Snapshot JSON: `BACKEND_PRICING_TABLES_SEED.json` (regenerate after FE price changes)
 *
 * Full API: `BACKEND_PRICING_TABLES_API.md`
 * Admin UI: Admin → Pricing → Save → PUT /api/quotations/pricing-tables
 * Dealer PDF: Calling Data → Download pricing PDF (reads GET)
 *
 * Regenerate seed JSON from FE (run in this repo):
 *   node --experimental-strip-types scripts/export-pricing-tables-seed.mjs
 *   (or the one-liner documented in BACKEND_PRICING_TABLES.md)
 */

export const PRICING_TABLES_META = {
  source: "lib/pricing-tables.ts",
  effectiveFrom: "2026-08-04",
  validTill: "2026-08-31",
  panelTypes: [
    "Adani",
    "Adani Topcon",
    "Waaree",
    "Waaree Topcon",
    "Premier Energies",
    "INA",
    "Tata",
    "Crompton set",
  ] as const,
} as const

/** Keys the frontend expects under GET/PUT `data`. */
export const PRICING_TABLES_DATA_KEYS = [
  "dcr",
  "nonDcr",
  "both",
  "panels",
  "inverters",
  "structures",
  "meters",
  "cables",
  "acdb",
  "dcdb",
  "systemConfigs",
] as const

export type PricingTablesDataKey = (typeof PRICING_TABLES_DATA_KEYS)[number]

export type SystemPricingRow = {
  systemSize: string
  phase: string
  inverterSize: string
  panelType: string
  price: number
  notes?: string
}

export type BothPricingRow = {
  systemSize: string
  phase: string
  inverterSize: string
  dcrCapacity: string
  nonDcrCapacity: string
  panelType: string
  price: number
}

export type PricingTablesPayload = {
  dcr: SystemPricingRow[]
  nonDcr: SystemPricingRow[]
  both: BothPricingRow[]
  panels: unknown[]
  inverters: unknown[]
  structures: unknown[]
  meters: unknown[]
  cables: unknown[]
  acdb: unknown[]
  dcdb: unknown[]
  systemConfigs: unknown[]
  /** Optional display meta (frontend may ignore). */
  meta?: {
    effectiveFrom?: string
    validTill?: string
    panelTypes?: string[]
  }
}

/**
 * Suggested SQL (Postgres) — single JSON document updated by Admin.
 *
 * CREATE TABLE IF NOT EXISTS pricing_config (
 *   id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
 *   payload JSONB NOT NULL,
 *   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   updated_by TEXT
 * );
 */

/** Normalize FE body / seed JSON into the GET response `data` object. */
export function normalizePricingTablesPayload(raw: unknown): PricingTablesPayload {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  // Accept either full seed `{ meta, dcr, ... }` or nested `{ data: { dcr, ... } }`
  const body =
    src.data && typeof src.data === "object"
      ? (src.data as Record<string, unknown>)
      : src

  const asArray = (v: unknown) => (Array.isArray(v) ? v : [])

  return {
    dcr: asArray(body.dcr) as SystemPricingRow[],
    nonDcr: asArray(body.nonDcr) as SystemPricingRow[],
    both: asArray(body.both) as BothPricingRow[],
    panels: asArray(body.panels),
    inverters: asArray(body.inverters),
    structures: asArray(body.structures),
    meters: asArray(body.meters),
    cables: asArray(body.cables),
    acdb: asArray(body.acdb),
    dcdb: asArray(body.dcdb),
    // FE uses `systemConfigs`; older docs said `systemConfigurations`
    systemConfigs: asArray(body.systemConfigs ?? body.systemConfigurations),
    meta: {
      effectiveFrom:
        (body.meta as { effectiveFrom?: string } | undefined)?.effectiveFrom ||
        (typeof body.effectiveFrom === "string" ? body.effectiveFrom : PRICING_TABLES_META.effectiveFrom),
      validTill:
        (body.meta as { validTill?: string } | undefined)?.validTill ||
        (typeof body.validTill === "string" ? body.validTill : PRICING_TABLES_META.validTill),
      panelTypes: [...PRICING_TABLES_META.panelTypes],
    },
  }
}

/** Merge PUT body onto existing row (partial top-level keys allowed). */
export function mergePricingTablesPayload(
  existing: PricingTablesPayload,
  patch: unknown,
): PricingTablesPayload {
  const next = normalizePricingTablesPayload(patch)
  const out: PricingTablesPayload = { ...existing }
  for (const key of PRICING_TABLES_DATA_KEYS) {
    const value = (patch as Record<string, unknown> | null)?.[key]
    // Only replace a key when the client sent that array (Admin sends full draft).
    if (Array.isArray(value)) {
      ;(out as Record<string, unknown>)[key] = value
    }
  }
  if (next.meta) out.meta = { ...existing.meta, ...next.meta }
  return normalizePricingTablesPayload(out)
}

/**
 * Express-style handlers (pseudo) — wire to your ORM.
 *
 * GET  /api/quotations/pricing-tables  — dealers, admins, visitors
 * PUT  /api/quotations/pricing-tables  — admin only
 *
 * Seed once:
 *   INSERT INTO pricing_config (id, payload)
 *   VALUES (1, $seedJson::jsonb)
 *   ON CONFLICT (id) DO NOTHING;
 *
 * Load seed from `BACKEND_PRICING_TABLES_SEED.json` then:
 *   normalizePricingTablesPayload(require('./BACKEND_PRICING_TABLES_SEED.json'))
 */
export function buildGetPricingTablesResponse(stored: unknown) {
  const data = normalizePricingTablesPayload(stored)
  return { success: true as const, data }
}

export function buildPutPricingTablesResponse(saved: PricingTablesPayload) {
  return { success: true as const, data: normalizePricingTablesPayload(saved) }
}

/**
 * Aug 2026 DCR sheet highlights (must be present after seed / re-seed).
 * Full row list lives in BACKEND_PRICING_TABLES_SEED.json → `dcr`.
 */
export const DCR_AUG_2026_SPOT_CHECKS: ReadonlyArray<{
  systemSize: string
  phase: "1-Phase" | "3-Phase"
  panelType: string
  price: number
}> = [
  { systemSize: "3kW", phase: "1-Phase", panelType: "Adani", price: 186_000 },
  { systemSize: "3kW", phase: "1-Phase", panelType: "Adani Topcon", price: 190_000 },
  { systemSize: "3kW", phase: "1-Phase", panelType: "Waaree", price: 185_000 },
  { systemSize: "3kW", phase: "1-Phase", panelType: "Waaree Topcon", price: 190_000 },
  { systemSize: "5kW", phase: "1-Phase", panelType: "Waaree Topcon", price: 280_000 },
  { systemSize: "10kW", phase: "3-Phase", panelType: "Adani", price: 499_000 },
  { systemSize: "10kW", phase: "3-Phase", panelType: "Waaree Topcon", price: 515_000 },
  { systemSize: "15kW", phase: "3-Phase", panelType: "Waaree", price: 680_000 },
  { systemSize: "15kW", phase: "3-Phase", panelType: "Waaree Topcon", price: 740_000 },
  { systemSize: "3kW", phase: "1-Phase", panelType: "Crompton set", price: 210_000 },
  { systemSize: "5kW", phase: "1-Phase", panelType: "Crompton set", price: 295_000 },
]

export function assertAug2026DcrSeed(dcr: SystemPricingRow[]): string[] {
  const errors: string[] = []
  for (const expect of DCR_AUG_2026_SPOT_CHECKS) {
    const row = dcr.find(
      (r) =>
        r.systemSize === expect.systemSize &&
        r.phase === expect.phase &&
        r.panelType === expect.panelType,
    )
    if (!row) {
      errors.push(`Missing DCR row ${expect.panelType} ${expect.systemSize} ${expect.phase}`)
      continue
    }
    if (Number(row.price) !== expect.price) {
      errors.push(
        `Price mismatch ${expect.panelType} ${expect.systemSize} ${expect.phase}: got ${row.price}, want ${expect.price}`,
      )
    }
  }
  const hasWaareeTopcon = dcr.some((r) => r.panelType === "Waaree Topcon")
  if (!hasWaareeTopcon) errors.push('Missing panelType "Waaree Topcon" (610W set)')
  return errors
}
