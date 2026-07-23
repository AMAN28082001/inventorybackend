// @ts-nocheck
/**
 * =============================================================================
 * BACKEND REFERENCE — Admin Product Needed (Jul 2026)
 * =============================================================================
 *
 * Frontend:
 *   - Admin Panel → Overview → **Product Needed**
 *   - lib/admin-product-needed.ts → eligibility + brand card aggregation
 *   - lib/operational-install-queue.ts → installation vs metering visibility
 *
 * Goal:
 *   Show what panels / inverters are still needed for jobs that are in
 *   **Pending Installation** (released to installer, not yet installer-approved,
 *   not in metering). Optional server aggregates = one card per brand with
 *   wattage / set lines inside (e.g. Waaree → 540W, 560W).
 *
 * Preferred endpoint (optional but recommended):
 *   GET /api/admin/product-needed?scope=installation_pending
 *
 * Until this route exists, the SPA keeps building from:
 *   GET /api/admin/quotations  (same Pending Installation filter client-side)
 *
 * Auth: quotation dealer admin OR inventory admin / super-admin JWT
 *   (same as GET /admin/quotations — see BACKEND_SUPER_ADMIN_QUOTATION_LOGIN.ts)
 *
 * Handoff: BACKEND_CHANGES_HANDOFF.md §28 (frontend may label this §13)
 *
 * =============================================================================
 */

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

const N = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const str = (v) => String(v ?? "").trim()

/** Normalize "As per the set" / "As per set" labels. */
function isAsPerTheSet(value) {
  const s = str(value).toLowerCase().replace(/\s+/g, " ")
  return s === "as per the set" || s === "as per set"
}

/**
 * Pending Installation statuses for Product Needed.
 * Same idea as Admin → Installation → Pending Installation:
 *   released to installer, NOT installer_approved, NOT metering.
 */
const INSTALLATION_PENDING_STATUSES = [
  "pending_installer",
  "installer_in_progress",
  "installer_partial_approved",
]

const METERING_OR_DONE = new Set([
  "installer_approved",
  "pending_baldev",
  "baldev_approved",
  "baldev_rejected",
  "pending_metering",
  "metering_in_progress",
  "metering_approved",
  "meter_installation_pending",
  "mco",
  "completed",
])

function isReleasedToInstaller(q) {
  return (
    q.installationReadyForInstaller === true ||
    q.installation_ready_for_installer === true ||
    q.installationReleasedAt != null ||
    q.installation_released_at != null
  )
}

function isInstallationPendingForProductNeeded(q) {
  if (String(q.status || "").toLowerCase() !== "approved") return false
  if (!isReleasedToInstaller(q)) return false
  const inst = str(q.installationStatus || q.installation_status || "pending_installer")
  if (METERING_OR_DONE.has(inst)) return false
  return INSTALLATION_PENDING_STATUSES.includes(inst) || !METERING_OR_DONE.has(inst)
}

/**
 * Build structured panel lines from quotation_products (and BOTH / CUSTOMIZE variants).
 *
 * Rules:
 * - Prefer concrete brand + wattage + quantity.
 * - Tata (or any) "As per the set" with qty 0 → treat as **1 set per job**.
 * - BOTH: emit separate DCR + Non-DCR lines when present.
 */
function buildPanelLines(products) {
  const p = products || {}
  const lines = []

  const pushLine = ({ brand, size, quantity, systemType, source }) => {
    const b = str(brand)
    const s = str(size)
    if (!b && !s) return
    let qty = N(quantity)
    // "As per the set" with 0 / missing qty → 1 set per job
    if (isAsPerTheSet(s) || isAsPerTheSet(b)) {
      if (qty <= 0) qty = 1
    }
    if (!b && !s) return
    lines.push({
      brand: b || "Unknown",
      size: s || (isAsPerTheSet(b) ? "As per the set" : ""),
      quantity: qty,
      unit: isAsPerTheSet(s) || isAsPerTheSet(b) ? "set" : "panel",
      systemType: systemType || p.systemType || null,
      source: source || "panel",
      isAsPerTheSet: isAsPerTheSet(s) || isAsPerTheSet(b),
    })
  }

  const systemType = str(p.systemType || p.system_type).toLowerCase()

  if (systemType === "both") {
    pushLine({
      brand: p.dcrPanelBrand ?? p.dcr_panel_brand ?? p.panelBrand,
      size: p.dcrPanelSize ?? p.dcr_panel_size,
      quantity: p.dcrPanelQuantity ?? p.dcr_panel_quantity,
      systemType: "both-dcr",
      source: "dcrPanel",
    })
    pushLine({
      brand: p.nonDcrPanelBrand ?? p.non_dcr_panel_brand ?? p.panelBrand,
      size: p.nonDcrPanelSize ?? p.non_dcr_panel_size,
      quantity: p.nonDcrPanelQuantity ?? p.non_dcr_panel_quantity,
      systemType: "both-nondcr",
      source: "nonDcrPanel",
    })
  } else if (systemType === "customize" && Array.isArray(p.customPanels || p.custom_panels)) {
    for (const row of p.customPanels || p.custom_panels) {
      pushLine({
        brand: row.brand ?? row.panelBrand ?? p.panelBrand,
        size: row.size ?? row.panelSize,
        quantity: row.quantity ?? row.panelQuantity,
        systemType: "customize",
        source: "customPanel",
      })
    }
  } else {
    pushLine({
      brand: p.panelBrand ?? p.panel_brand,
      size: p.panelSize ?? p.panel_size,
      quantity: p.panelQuantity ?? p.panel_quantity,
      systemType: systemType || null,
      source: "panel",
    })
  }

  return lines
}

function buildInverterLine(products) {
  const p = products || {}
  const brand = str(p.inverterBrand ?? p.inverter_brand)
  const size = str(p.inverterSize ?? p.inverter_size)
  if (!brand && !size) return null
  let qty = N(p.inverterQuantity ?? p.inverter_quantity)
  if (isAsPerTheSet(brand) || isAsPerTheSet(size)) {
    if (qty <= 0) qty = 1
  } else if (qty <= 0) {
    qty = 1 // one inverter per job when unspecified
  }
  return {
    brand: brand || "Unknown",
    size: size || "",
    quantity: qty,
    unit: isAsPerTheSet(brand) || isAsPerTheSet(size) ? "set" : "inverter",
    isAsPerTheSet: isAsPerTheSet(brand) || isAsPerTheSet(size),
  }
}

/**
 * Aggregate panel lines into brand cards for the Overview dashboard.
 *
 * Example:
 *   Waaree → [{ size: "540W", quantity: 12 }, { size: "560W", quantity: 8 }]
 *   Tata   → [{ size: "As per the set", quantity: 3, unit: "set" }]
 */
function aggregateBrandCards(rows) {
  /** @type {Map<string, Map<string, { size: string, quantity: number, unit: string, jobs: number }>>} */
  const byBrand = new Map()

  for (const row of rows) {
    for (const line of row.panelLines || []) {
      const brand = line.brand || "Unknown"
      const sizeKey = line.size || (line.isAsPerTheSet ? "As per the set" : "Unknown")
      if (!byBrand.has(brand)) byBrand.set(brand, new Map())
      const sizes = byBrand.get(brand)
      const prev = sizes.get(sizeKey) || {
        size: sizeKey,
        quantity: 0,
        unit: line.unit || "panel",
        jobs: 0,
      }
      prev.quantity += N(line.quantity)
      prev.jobs += 1
      sizes.set(sizeKey, prev)
    }
  }

  return [...byBrand.entries()]
    .map(([brand, sizes]) => ({
      brand,
      totalQuantity: [...sizes.values()].reduce((a, s) => a + s.quantity, 0),
      jobCount: [...sizes.values()].reduce((a, s) => a + s.jobs, 0),
      lines: [...sizes.values()].sort((a, b) => a.size.localeCompare(b.size)),
    }))
    .sort((a, b) => a.brand.localeCompare(b.brand))
}

function serializeProductNeededRow(quotation) {
  const products =
    quotation.products ||
    quotation.quotationProduct ||
    (Array.isArray(quotation.quotationProducts) ? quotation.quotationProducts[0] : null) ||
    {}
  const panelLines = buildPanelLines(products)
  const inverter = buildInverterLine(products)
  return {
    id: quotation.id,
    quotationId: quotation.id,
    status: quotation.status,
    installationStatus: quotation.installationStatus || "pending_installer",
    installation_status: quotation.installationStatus || "pending_installer",
    installationReadyForInstaller: !!quotation.installationReadyForInstaller,
    installationReleasedAt: quotation.installationReleasedAt || null,
    customerName: quotation.customerName || quotation.customer_name || null,
    phoneNumber: quotation.phoneNumber || quotation.phone_number || null,
    dealerId: quotation.dealerId || quotation.dealer_id || null,
    dealer: quotation.dealer || null,
    systemKw: quotation.systemKw ?? quotation.system_kw ?? null,
    products,
    panelLines,
    inverter,
    inverterBrand: inverter?.brand || null,
    inverterSize: inverter?.size || null,
    inverterQuantity: inverter?.quantity ?? null,
  }
}

// -----------------------------------------------------------------------------
// 1) PREFERRED — GET /api/admin/product-needed?scope=installation_pending
// -----------------------------------------------------------------------------
/**
 * Query:
 *   scope=installation_pending   (default / only supported scope for now)
 *   limit? page? dealerId?       (optional)
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "scope": "installation_pending",
 *     "quotations": [ { id, panelLines, inverter, ... } ],
 *     "brandCards": [
 *       {
 *         "brand": "Waaree",
 *         "totalQuantity": 20,
 *         "jobCount": 2,
 *         "lines": [
 *           { "size": "540W", "quantity": 12, "unit": "panel", "jobs": 1 },
 *           { "size": "560W", "quantity": 8, "unit": "panel", "jobs": 1 }
 *         ]
 *       },
 *       {
 *         "brand": "Tata",
 *         "totalQuantity": 1,
 *         "jobCount": 1,
 *         "lines": [
 *           { "size": "As per the set", "quantity": 1, "unit": "set", "jobs": 1 }
 *         ]
 *       }
 *     ],
 *     "totals": { "jobs": 3, "panelQuantity": 21 }
 *   }
 * }
 */
export async function getAdminProductNeeded(req, res) {
  try {
    // Reuse the same admin gate as GET /admin/quotations
    if (!hasAdminQuotationAccess(req)) {
      return res.status(403).json({
        success: false,
        error: { code: "AUTH_004", message: "Admin access required" },
      })
    }

    const scope = String(req.query.scope || "installation_pending").toLowerCase()
    if (scope !== "installation_pending") {
      return res.status(400).json({
        success: false,
        error: {
          code: "VAL_001",
          message: 'scope must be "installation_pending"',
        },
      })
    }

    const where = {
      status: "approved",
      [Op.and]: [
        // released to installer (Payment Management send)
        {
          [Op.or]: [
            { installationReadyForInstaller: true },
            { installationReleasedAt: { [Op.ne]: null } },
          ],
        },
        // still Pending Installation (not metering / not fully approved install)
        {
          installationStatus: { [Op.in]: INSTALLATION_PENDING_STATUSES },
        },
      ],
    }

    if (req.query.dealerId) where.dealerId = String(req.query.dealerId)

    const rows = await Quotation.findAll({
      where,
      include: [
        { model: QuotationProduct, as: "products" },
        {
          model: Dealer,
          as: "dealer",
          attributes: ["id", "firstName", "lastName", "email", "mobile", "username", "role"],
        },
      ],
      order: [["installationReleasedAt", "DESC"]],
    })

    const quotations = rows
      .filter(isInstallationPendingForProductNeeded)
      .map((q) => serializeProductNeededRow(q.get ? q.get({ plain: true }) : q))

    const brandCards = aggregateBrandCards(quotations)
    const totals = {
      jobs: quotations.length,
      panelQuantity: quotations.reduce(
        (acc, r) => acc + (r.panelLines || []).reduce((a, l) => a + N(l.quantity), 0),
        0,
      ),
    }

    return res.json({
      success: true,
      data: {
        scope: "installation_pending",
        quotations,
        brandCards,
        totals,
      },
    })
  } catch (e) {
    console.error("[product-needed] error", e)
    return res.status(500).json({
      success: false,
      error: { code: "SYS_001", message: "Internal server error" },
    })
  }
}

// -----------------------------------------------------------------------------
// 2) Fallback — enrich GET /admin/quotations so SPA can build Product Needed
// -----------------------------------------------------------------------------
/**
 * Until GET /admin/product-needed ships, Admin Overview builds cards from
 * GET /admin/quotations with the Pending Installation filter:
 *
 *   GET /api/admin/quotations?status=approved&operationalView=installer
 *     &installationStatus=pending_installer,installer_in_progress,installer_partial_approved
 *     &releasedToInstaller=true
 *
 * Each row MUST include enough product fields for the SPA:
 *   products.panelBrand, panelSize, panelQuantity
 *   products.dcrPanel* / nonDcrPanel* (BOTH)
 *   products.inverterBrand, inverterSize
 *   systemKw (optional)
 *
 * Optional: also return `panelLines` + `brandCards` on that list for free.
 * Prefer implementing the dedicated route above.
 */

export function extendAdminQuotationRowForProductNeeded(json, quotation) {
  const products = json.products || quotation.products || {}
  const panelLines = buildPanelLines(products)
  const inverter = buildInverterLine(products)
  return {
    ...json,
    panelLines,
    inverter,
    inverterBrand: inverter?.brand ?? json.inverterBrand ?? null,
    inverterSize: inverter?.size ?? json.inverterSize ?? null,
  }
}

// -----------------------------------------------------------------------------
// 3) Route registration (Express)
// -----------------------------------------------------------------------------
/*
router.get(
  "/product-needed",
  authAdmin,                          // same as /admin/quotations
  getAdminProductNeeded,
)
// Full path: GET /api/admin/product-needed?scope=installation_pending
*/

// -----------------------------------------------------------------------------
// 4) QA checklist
// -----------------------------------------------------------------------------
/*
 1. Release a quote to installer (pending_installer) with Waaree 540W × 10.
 2. GET /admin/product-needed?scope=installation_pending → 200.
 3. Response includes that row in data.quotations with panelLines.
 4. brandCards contains Waaree → { size: "540W", quantity: 10 }.
 5. Tata job with size "As per the set" and qty 0 → line quantity 1, unit "set".
 6. After Send to Metering (pending_metering) → row LEAVES Product Needed.
 7. After installer_approved → row LEAVES Product Needed.
 8. Unreleased approved quote (no installationReleasedAt) → NOT included.
 9. Until route exists: SPA still works from GET /admin/quotations product fields.
 10. Auth: non-admin → 403.
*/

export {
  buildPanelLines,
  buildInverterLine,
  aggregateBrandCards,
  isInstallationPendingForProductNeeded,
  INSTALLATION_PENDING_STATUSES,
}
