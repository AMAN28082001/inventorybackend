// @ts-nocheck
/**
 * =============================================================================
 * BACKEND REFERENCE — Admin Product Needed (Jul 2026)
 * =============================================================================
 *
 * Frontend:
 *   - Admin Panel → Overview → **Product Needed**
 *   - lib/admin-product-needed.ts → isQuotationEligibleForProductNeeded,
 *     aggregateProductNeededDashboard
 *   - lib/load-admin-product-needed.ts → api.admin.productNeeded.getAll
 *   - lib/operational-install-queue.ts → installation vs metering visibility
 *
 * Goal:
 *   Procurement dashboard for **installation-pending jobs only**
 *   (same gate as Admin → Pending Installation):
 *   - One brand card per panel brand (Waaree, Adani, Tata…) with wattage/set lines
 *   - One brand card per inverter brand with kW/set lines
 *   - “As per the set” with missing qty → **1 set per job**
 *     (e.g. Tata across 2 jobs = **2 sets**)
 *
 * Preferred:
 *   GET /api/admin/product-needed?scope=installation_pending
 *
 * Shipped: controllers/adminController.ts → getAdminProductNeeded
 *          utils/adminProductNeeded.ts
 *          routes/adminRoutes.ts → GET /product-needed
 *
 * SPA still falls back to GET /api/admin/quotations if this route 404s.
 *
 * Auth: admin JWT only (quotation admin / inventory admin / super-admin).
 * Handoff: BACKEND_CHANGES_HANDOFF.md §13 (Product Needed)
 *
 * =============================================================================
 */

const N = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const str = (v) => String(v ?? "").trim()

function isAsPerTheSet(value) {
  const s = str(value).toLowerCase().replace(/\s+/g, " ")
  return s === "as per the set" || s === "as per set"
}

/** Normalize wattage labels → "540W". Pass through "As per the set". */
function normalizeWattageSize(size) {
  const s = str(size)
  if (!s) return ""
  if (isAsPerTheSet(s)) return "As per the set"
  const m = s.match(/(\d+(?:\.\d+)?)\s*w/i)
  if (m) return `${m[1]}W`
  if (/^\d+(\.\d+)?$/.test(s)) return `${s}W`
  return s
}

function normalizeKwSize(size) {
  const s = str(size)
  if (!s) return ""
  if (isAsPerTheSet(s)) return "As per the set"
  const m = s.match(/(\d+(?:\.\d+)?)\s*kw/i)
  if (m) return `${m[1]}kW`
  return s
}

/**
 * Pending Installation only — exclude partial / approved / metering / baldev.
 * Matches Admin → Installation → Pending Installation.
 */
const INSTALLATION_PENDING_STATUSES = ["pending_installer", "installer_in_progress"]

const EXCLUDED_STATUSES = new Set([
  "installer_partial_approved",
  "installer_approved",
  "installer_rejected",
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
    q.installation_released_at != null ||
    ["pending_installer", "installer_in_progress"].includes(
      str(q.installationStatus || q.installation_status),
    )
  )
}

/** Same rules as lib/admin-product-needed.ts → isQuotationEligibleForProductNeeded */
function isQuotationEligibleForProductNeeded(q) {
  if (String(q.status || q.quotationStatus || "").toLowerCase() !== "approved") return false
  if (!isReleasedToInstaller(q)) return false
  if (q.installerApprovedAt || q.installer_approved_at) return false
  const inst = str(q.installationStatus || q.installation_status || "pending_installer")
  if (EXCLUDED_STATUSES.has(inst)) return false
  return INSTALLATION_PENDING_STATUSES.includes(inst) || inst === "" || inst === "pending_installer"
}

function effectiveQty(quantity, sizeOrBrand) {
  let qty = N(quantity)
  if (isAsPerTheSet(sizeOrBrand) && qty <= 0) return 1
  return qty
}

function buildPanelLines(products) {
  const p = products || {}
  const lines = []
  const push = ({ brand, size, quantity, systemType, source }) => {
    const b = str(brand)
    const rawSize = str(size)
    if (!b && !rawSize) return
    const set = isAsPerTheSet(b) || isAsPerTheSet(rawSize)
    const sizeNorm = normalizeWattageSize(rawSize || (set ? "As per the set" : ""))
    const qty = effectiveQty(quantity, set ? "As per the set" : rawSize)
    lines.push({
      brand: b || "Unknown",
      size: sizeNorm || (set ? "As per the set" : ""),
      quantity: qty,
      unit: set ? "sets" : "panels",
      systemType: systemType || p.systemType || null,
      source: source || "panel",
      isAsPerTheSet: set,
    })
  }

  const systemType = str(p.systemType || p.system_type).toLowerCase()
  if (systemType === "both") {
    push({
      brand: p.dcrPanelBrand ?? p.dcr_panel_brand ?? p.panelBrand,
      size: p.dcrPanelSize ?? p.dcr_panel_size,
      quantity: p.dcrPanelQuantity ?? p.dcr_panel_quantity,
      systemType: "both-dcr",
      source: "dcrPanel",
    })
    push({
      brand: p.nonDcrPanelBrand ?? p.non_dcr_panel_brand ?? p.panelBrand,
      size: p.nonDcrPanelSize ?? p.non_dcr_panel_size,
      quantity: p.nonDcrPanelQuantity ?? p.non_dcr_panel_quantity,
      systemType: "both-nondcr",
      source: "nonDcrPanel",
    })
  } else if (systemType === "customize" && Array.isArray(p.customPanels || p.custom_panels)) {
    for (const row of p.customPanels || p.custom_panels) {
      push({
        brand: row.brand ?? row.panelBrand ?? p.panelBrand,
        size: row.size ?? row.panelSize,
        quantity: row.quantity ?? row.panelQuantity,
        systemType: "customize",
        source: "customPanel",
      })
    }
  } else {
    push({
      brand: p.panelBrand ?? p.panel_brand ?? p.dcrPanelBrand,
      size: p.panelSize ?? p.panel_size ?? p.dcrPanelSize,
      quantity: p.panelQuantity ?? p.panel_quantity ?? p.dcrPanelQuantity,
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
  const set = isAsPerTheSet(brand) || isAsPerTheSet(size)
  let qty = N(p.inverterQuantity ?? p.inverter_quantity)
  if (set && qty <= 0) qty = 1
  else if (qty <= 0) qty = 1
  return {
    brand: brand || "Unknown",
    size: normalizeKwSize(size || (set ? "As per the set" : "")),
    quantity: qty,
    unit: set ? "sets" : "inverters",
    isAsPerTheSet: set,
  }
}

/**
 * Brand aggregates for Overview cards.
 * Two Adani jobs (540W×10, 620W×5) → ONE Adani card with two size lines.
 * Two Tata set jobs qty 0 → Tata card quantity 2 (sets).
 */
function buildBrandAggregates(rows) {
  const panelMap = new Map()
  const inverterMap = new Map()

  const bump = (map, brand, size, quantity, unit) => {
    const b = brand || "Unknown"
    const s = size || "Unknown"
    if (!map.has(b)) map.set(b, new Map())
    const sizes = map.get(b)
    const prev = sizes.get(s) || { size: s, quantity: 0, jobCount: 0, unit }
    prev.quantity += N(quantity)
    prev.jobCount += 1
    prev.unit = unit
    sizes.set(s, prev)
  }

  for (const row of rows) {
    for (const line of row.panelLines || []) {
      bump(panelMap, line.brand, line.size, line.quantity, line.unit || "panels")
    }
    if (row.inverterBrand || row.inverter?.brand) {
      const inv = row.inverter || {
        brand: row.inverterBrand,
        size: row.inverterSize,
        quantity: row.inverterQuantity ?? 1,
        unit: "inverters",
      }
      bump(
        inverterMap,
        inv.brand,
        inv.size,
        inv.quantity,
        inv.unit || (inv.isAsPerTheSet ? "sets" : "inverters"),
      )
    }
  }

  const toCards = (map) =>
    [...map.entries()]
      .map(([brand, sizes]) => {
        const sizeList = [...sizes.values()].sort((a, b) => a.size.localeCompare(b.size))
        return {
          brand,
          totalQuantity: sizeList.reduce((a, s) => a + s.quantity, 0),
          jobCount: sizeList.reduce((a, s) => a + s.jobCount, 0),
          sizes: sizeList,
        }
      })
      .sort((a, b) => a.brand.localeCompare(b.brand))

  const panels = toCards(panelMap)
  const inverters = toCards(inverterMap)
  return {
    jobCount: rows.length,
    totalPanels: panels.reduce((a, c) => a + c.totalQuantity, 0),
    totalInverters: inverters.reduce((a, c) => a + c.totalQuantity, 0),
    panels,
    inverters,
  }
}

function dealerDisplayName(dealer) {
  if (!dealer) return null
  const n = [dealer.firstName, dealer.lastName].filter(Boolean).join(" ").trim()
  return n || dealer.username || dealer.name || null
}

function serializeProductNeededRow(quotation) {
  const products =
    quotation.products ||
    quotation.quotationProduct ||
    (Array.isArray(quotation.quotationProducts) ? quotation.quotationProducts[0] : null) ||
    {}
  const panelLines = buildPanelLines(products)
  const inverter = buildInverterLine(products)
  const panelsSummary = panelLines
    .map((l) => `${l.brand} ${l.size} × ${l.quantity}`)
    .join(", ")
  return {
    quotationId: quotation.id,
    id: quotation.id,
    dealerId: quotation.dealerId || quotation.dealer_id || null,
    customerName:
      quotation.customerName ||
      [quotation.customer?.firstName, quotation.customer?.lastName].filter(Boolean).join(" ") ||
      null,
    customerMobile: quotation.phoneNumber || quotation.customer?.mobile || null,
    dealerName: dealerDisplayName(quotation.dealer),
    systemKw: quotation.systemKw ?? quotation.system_kw ?? null,
    systemType: products.systemType || products.system_type || null,
    panels: panelsSummary,
    inverter: inverter
      ? `${inverter.brand}${inverter.size ? ` · ${inverter.size}` : ""}`
      : null,
    panelLines,
    inverterBrand: inverter?.brand || null,
    inverterSize: inverter?.size || null,
    inverterQuantity: inverter?.quantity ?? null,
    inverter,
    installationStatus: quotation.installationStatus || "pending_installer",
    installationReleasedAt: quotation.installationReleasedAt || null,
    quotationStatus: quotation.status,
    products,
  }
}

// -----------------------------------------------------------------------------
// GET /api/admin/product-needed?scope=installation_pending
// -----------------------------------------------------------------------------
/**
 * Query params:
 *   scope=installation_pending (default) — do NOT require tab=file_login
 *   dealerId, search, startDate, endDate
 *   dateField=installation_released|created (default installation_released)
 *   page, limit (default 500, max 2000)
 *
 * aggregates computed on FULL filtered set before pagination.
 */
export async function getAdminProductNeeded(req, res) {
  try {
    if (!hasAdminQuotationAccess(req)) {
      return res.status(403).json({
        success: false,
        error: { code: "AUTH_004", message: "Admin access required" },
      })
    }

    const scope = String(req.query.scope || "installation_pending").toLowerCase()
    if (scope && scope !== "installation_pending") {
      return res.status(400).json({
        success: false,
        error: { code: "VAL_001", message: 'scope must be "installation_pending"' },
      })
    }

    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1)
    const limit = Math.min(
      2000,
      Math.max(1, parseInt(String(req.query.limit || "500"), 10) || 500),
    )
    const dealerId = req.query.dealerId ? String(req.query.dealerId) : null
    const search = req.query.search ? String(req.query.search).trim().toLowerCase() : ""
    const dateField =
      String(req.query.dateField || "installation_released").toLowerCase() === "created"
        ? "createdAt"
        : "installationReleasedAt"
    const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : null
    const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : null

    const where = {
      status: "approved",
      [Op.and]: [
        {
          [Op.or]: [
            { installationReadyForInstaller: true },
            { installationReleasedAt: { [Op.ne]: null } },
            { installationStatus: { [Op.in]: INSTALLATION_PENDING_STATUSES } },
          ],
        },
        {
          installationStatus: { [Op.in]: INSTALLATION_PENDING_STATUSES },
        },
        { installerApprovedAt: null },
      ],
    }
    if (dealerId) where.dealerId = dealerId
    if (startDate || endDate) {
      where[dateField] = {}
      if (startDate && !isNaN(startDate.getTime())) where[dateField][Op.gte] = startDate
      if (endDate && !isNaN(endDate.getTime())) where[dateField][Op.lte] = endDate
    }

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

    let all = rows
      .map((q) => (q.get ? q.get({ plain: true }) : q))
      .filter(isQuotationEligibleForProductNeeded)
      .map(serializeProductNeededRow)

    if (search) {
      all = all.filter((r) => {
        const blob = [
          r.customerName,
          r.customerMobile,
          r.dealerName,
          r.quotationId,
          r.panels,
          r.inverter,
        ]
          .join(" ")
          .toLowerCase()
        return blob.includes(search)
      })
    }

    // Aggregates on FULL filtered set (before pagination)
    const aggregates = buildBrandAggregates(all)
    const total = all.length
    const offset = (page - 1) * limit
    const pageRows = all.slice(offset, offset + limit)

    return res.json({
      success: true,
      data: {
        scope: "installation_pending",
        rows: pageRows,
        quotations: pageRows, // alias for older clients
        aggregates,
        brandCards: aggregates.panels, // alias
        totals: {
          jobs: aggregates.jobCount,
          panelQuantity: aggregates.totalPanels,
          inverterQuantity: aggregates.totalInverters,
        },
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      },
    })
  } catch (e) {
    console.error("[product-needed] error", e)
    return res.status(500).json({
      success: false,
      error: { code: "SYS_001", message: e?.message || "Internal server error" },
    })
  }
}

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
    inverterQuantity: inverter?.quantity ?? json.inverterQuantity ?? null,
  }
}

/*
router.get("/product-needed", authAdmin, getAdminProductNeeded)
// GET /api/admin/product-needed?scope=installation_pending
*/

/*
QA:
1. Send job to installer → appears in Product Needed; approve install → leaves.
2. Two Adani jobs (540W×10, 620W×5) → one Adani card, two size lines.
3. Two Tata “As per the set” qty 0 → Tata card shows 2 sets.
4. Filter dealerId → totals only for that dealer.
5. Non-admin → 403.
6. Route 404 → SPA still works from GET /admin/quotations.
*/

export {
  buildPanelLines,
  buildInverterLine,
  buildBrandAggregates,
  isQuotationEligibleForProductNeeded,
  INSTALLATION_PENDING_STATUSES,
}
