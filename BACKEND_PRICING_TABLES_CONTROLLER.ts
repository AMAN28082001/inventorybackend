/**
 * Backend copy-paste — Pricing tables GET + PUT (Admin Pricing tab)
 *
 * Spec: BACKEND_PRICING_TABLES.md
 * Seed: BACKEND_PRICING_TABLES_SEED.json + helpers in BACKEND_PRICING_TABLES_SEED.ts
 * FE: Admin → Pricing (edit DCR / Non-DCR / BOTH) → confirm → Save
 *     → PUT /api/quotations/pricing-tables
 *     Dealers: GET same endpoint for New Quotation + Calling Data pricing PDF
 *
 * IMPORTANT:
 * - Add/Delete in Admin are draft-only until Save.
 * - Save sends the FULL payload (all three tables + component arrays).
 * - PUT must persist `dcr`, `nonDcr`, and `both` as sent (replace those arrays).
 * - Next GET must echo the saved values (no FE-only persistence).
 *
 * Wire into your Express/Fastify router (paths relative to /api):
 *   GET  /quotations/pricing-tables
 *   PUT  /quotations/pricing-tables
 */

import {
  assertAug2026DcrSeed,
  buildGetPricingTablesResponse,
  buildPutPricingTablesResponse,
  mergePricingTablesPayload,
  normalizePricingTablesPayload,
  type PricingTablesPayload,
} from "./BACKEND_PRICING_TABLES_SEED"

// ---------------------------------------------------------------------------
// Storage adapter — replace with your ORM / SQL
// ---------------------------------------------------------------------------

type PricingConfigStore = {
  /** Load singleton row (id=1). Return null if missing. */
  get(): Promise<PricingTablesPayload | null>
  /** Upsert singleton row. */
  save(payload: PricingTablesPayload, updatedBy?: string): Promise<PricingTablesPayload>
}

/**
 * Example Postgres adapter (pseudo):
 *
 * async get() {
 *   const row = await db.query(`SELECT payload FROM pricing_config WHERE id = 1`)
 *   return row.rows[0] ? normalizePricingTablesPayload(row.rows[0].payload) : null
 * }
 * async save(payload, updatedBy) {
 *   await db.query(
 *     `INSERT INTO pricing_config (id, payload, updated_at, updated_by)
 *      VALUES (1, $1::jsonb, NOW(), $2)
 *      ON CONFLICT (id) DO UPDATE
 *      SET payload = EXCLUDED.payload, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
 *     [JSON.stringify(payload), updatedBy ?? null],
 *   )
 *   return payload
 * }
 */

/** In-memory fallback for local bring-up — replace in production. */
function createMemoryStore(seed: unknown): PricingConfigStore {
  let current: PricingTablesPayload | null = normalizePricingTablesPayload(seed)
  return {
    async get() {
      return current
    },
    async save(payload) {
      current = normalizePricingTablesPayload(payload)
      return current
    },
  }
}

// ---------------------------------------------------------------------------
// Auth helpers — plug into your middleware
// ---------------------------------------------------------------------------

function isAdmin(req: { user?: { role?: string }; admin?: unknown }): boolean {
  const role = String(req.user?.role || "").toLowerCase()
  return Boolean(req.admin) || role === "admin" || role === "super-admin" || role === "super_admin"
}

function actorId(req: { user?: { id?: string; username?: string }; admin?: { id?: string } }): string | undefined {
  return req.admin?.id || req.user?.id || req.user?.username
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export type PricingTablesHandlersDeps = {
  store: PricingConfigStore
  /** Optional seed used when DB empty (load BACKEND_PRICING_TABLES_SEED.json). */
  seedPayload?: unknown
}

export function createPricingTablesHandlers(deps: PricingTablesHandlersDeps) {
  const { store, seedPayload } = deps

  async function ensureSeeded(): Promise<PricingTablesPayload> {
    const existing = await store.get()
    if (existing && (existing.dcr.length > 0 || existing.nonDcr.length > 0 || existing.both.length > 0)) {
      return existing
    }
    if (seedPayload) {
      const seeded = normalizePricingTablesPayload(seedPayload)
      return store.save(seeded, "seed")
    }
    // Empty but valid shape — FE will fall back to hardcoded tables if all empty
    return normalizePricingTablesPayload({})
  }

  /** GET /api/quotations/pricing-tables — dealers, admins, visitors */
  async function getPricingTables(_req: unknown, res: {
    status: (code: number) => { json: (body: unknown) => void }
    json: (body: unknown) => void
  }) {
    try {
      const data = await ensureSeeded()
      return res.json(buildGetPricingTablesResponse(data))
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load pricing tables"
      return res.status(500).json({ success: false, error: { code: "PRICING_001", message } })
    }
  }

  /**
   * PUT /api/quotations/pricing-tables — admin only
   *
   * Body (from Admin → Pricing Save): PricingTablesPayload fields at root
   *   { dcr: [...], nonDcr: [...], both: [...], panels?, inverters?, …, systemConfigs? }
   *
   * Behavior:
   * 1. Reject non-admin → 403
   * 2. Require at least one of dcr / nonDcr / both to be an array (Admin always sends all three)
   * 3. Merge onto existing (replace keys that are arrays in the body)
   * 4. Persist and return { success: true, data: saved }
   */
  async function putPricingTables(
    req: {
      body?: unknown
      user?: { role?: string; id?: string; username?: string }
      admin?: { id?: string }
    },
    res: {
      status: (code: number) => { json: (body: unknown) => void }
      json: (body: unknown) => void
    },
  ) {
    try {
      if (!isAdmin(req)) {
        return res.status(403).json({
          success: false,
          error: { code: "AUTH_403", message: "Admin only — cannot update pricing tables" },
        })
      }

      const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>
      // FE may send either flat payload or { data: { … } }
      const patch = body.data && typeof body.data === "object" ? body.data : body

      const hasDcr = Array.isArray((patch as Record<string, unknown>).dcr)
      const hasNonDcr = Array.isArray((patch as Record<string, unknown>).nonDcr)
      const hasBoth = Array.isArray((patch as Record<string, unknown>).both)
      if (!hasDcr && !hasNonDcr && !hasBoth) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VAL_001",
            message: "Body must include at least one of: dcr, nonDcr, both (arrays)",
            details: [
              { field: "dcr", message: "array of package rows" },
              { field: "nonDcr", message: "array of package rows" },
              { field: "both", message: "array of package rows" },
            ],
          },
        })
      }

      // Light row validation for set-price tables
      const validateSystemRows = (rows: unknown, field: string) => {
        if (!Array.isArray(rows)) return null
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i] as Record<string, unknown>
          if (!row || typeof row !== "object") {
            return { field: `${field}[${i}]`, message: "row must be an object" }
          }
          if (!String(row.systemSize || "").trim()) {
            return { field: `${field}[${i}].systemSize`, message: "required" }
          }
          if (!String(row.panelType || "").trim()) {
            return { field: `${field}[${i}].panelType`, message: "required" }
          }
          if (!Number.isFinite(Number(row.price))) {
            return { field: `${field}[${i}].price`, message: "must be a number" }
          }
        }
        return null
      }

      for (const field of ["dcr", "nonDcr", "both"] as const) {
        const err = validateSystemRows((patch as Record<string, unknown>)[field], field)
        if (err) {
          return res.status(400).json({
            success: false,
            error: { code: "VAL_001", message: err.message, details: [err] },
          })
        }
      }

      const existing = await ensureSeeded()
      const merged = mergePricingTablesPayload(existing, patch)
      const saved = await store.save(merged, actorId(req))

      return res.json(buildPutPricingTablesResponse(saved))
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save pricing tables"
      return res.status(500).json({ success: false, error: { code: "PRICING_002", message } })
    }
  }

  return { getPricingTables, putPricingTables, ensureSeeded }
}

/**
 * Example route registration:
 *
 * import seed from './BACKEND_PRICING_TABLES_SEED.json'
 * const store = createPostgresStore() // your impl
 * const { getPricingTables, putPricingTables } = createPricingTablesHandlers({ store, seedPayload: seed })
 *
 * router.get('/quotations/pricing-tables', authenticate, getPricingTables)
 * router.put('/quotations/pricing-tables', authenticate, requireAdmin, putPricingTables)
 *
 * // Optional: verify seed after deploy
 * const data = await store.get()
 * const errs = assertAug2026DcrSeed(data?.dcr ?? [])
 * if (errs.length) console.warn('[pricing-tables] seed spot-check failed', errs)
 */

export { createMemoryStore, assertAug2026DcrSeed }
