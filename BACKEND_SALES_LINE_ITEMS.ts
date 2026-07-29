// @ts-nocheck
/**
 * =============================================================================
 * BACKEND REFERENCE — Persist & return sale line qty / unit_price (Jul 2026)
 * =============================================================================
 *
 * Handoff: BACKEND_CHANGES_HANDOFF.md §22
 * Related: BACKEND_SALES_CREATED_BY.ts (§20), BACKEND_SALES_ADMIN_STOCK.ts (§21)
 *
 * Frontend:
 *   Quotation Admin → Inventory → Agent → Sales History → "View items"
 *   Also Approvals → Pending Sales → "View items"
 *
 * Live UI bug:
 *   Expanded items show:  Qty 0.00 × ₹0 = ₹104
 *   Line amount is present; quantity and unit_price come back as 0 / missing.
 *
 * Cause:
 *   POST /sales either:
 *     - ignores body.items[].quantity / unit_price when inserting sale_items, OR
 *     - stores them but GET /sales and GET /sales/:id serialize only amount/subtotal
 *       (or map wrong column names so qty/price always read as 0).
 *
 * REQUIRED:
 *   1. On create: persist each line's quantity, unit_price, gst_rate, and line amount
 *   2. On list/detail: return those fields with product (id + name) nested when possible
 *   3. Persist sale-level subtotal / tax_amount / total_amount from the body (or recompute)
 */

/** Normalize one request line (accept common aliases). */
export function normalizeIncomingSaleItem(raw = {}) {
  const product_id = String(raw.product_id || raw.productId || "").trim()
  const quantity = Number(
    raw.quantity ?? raw.qty ?? raw.Qty ?? raw.billedqty ?? raw.billed_qty ?? 0,
  )
  const unit_price = Number(
    raw.unit_price ?? raw.unitPrice ?? raw.rate ?? raw.Rate ?? raw.price ?? 0,
  )
  const gst_rate = Number(raw.gst_rate ?? raw.gstRate ?? raw.tax_rate ?? 0)
  let line_subtotal = Number(
    raw.subtotal ?? raw.line_total ?? raw.lineTotal ?? raw.amount ?? 0,
  )
  if (!(line_subtotal > 0) && quantity > 0 && unit_price >= 0) {
    line_subtotal = quantity * unit_price
  }
  return {
    product_id,
    quantity: Number.isFinite(quantity) ? quantity : 0,
    unit_price: Number.isFinite(unit_price) ? unit_price : 0,
    gst_rate: Number.isFinite(gst_rate) ? gst_rate : 0,
    subtotal: Number.isFinite(line_subtotal) ? line_subtotal : 0,
    serial_numbers: Array.isArray(raw.serial_numbers)
      ? raw.serial_numbers
      : Array.isArray(raw.serialNumbers)
        ? raw.serialNumbers
        : undefined,
  }
}

/**
 * Build sale_items rows for INSERT.
 * Reject lines with missing product or non-positive qty (stock deduct needs real qty — §21).
 */
export function buildSaleItemRows(body = {}) {
  const items = Array.isArray(body.items) ? body.items : []
  const rows = []
  for (const raw of items) {
    const line = normalizeIncomingSaleItem(raw)
    if (!line.product_id || !(line.quantity > 0)) continue
    rows.push(line)
  }
  return rows
}

/** Sale header money fields — prefer body, else sum lines. */
export function resolveSaleMoneyFields(body = {}, itemRows = []) {
  const itemsSubtotal = itemRows.reduce((a, r) => a + Number(r.subtotal || 0), 0)
  const itemsTax = itemRows.reduce((a, r) => {
    const base = Number(r.quantity || 0) * Number(r.unit_price || 0)
    return a + (base * Number(r.gst_rate || 0)) / 100
  }, 0)

  const subtotal = Number(body.subtotal ?? body.sub_total ?? itemsSubtotal)
  const tax_amount = Number(body.tax_amount ?? body.taxAmount ?? itemsTax)
  const discount_amount = Number(body.discount_amount ?? body.discountAmount ?? 0)
  let total_amount = Number(
    body.total_amount ?? body.totalAmount ?? body.final_amount ?? body.finalAmount ?? 0,
  )
  if (!(total_amount > 0)) {
    total_amount = Math.max(0, subtotal + tax_amount - discount_amount)
  }
  return {
    subtotal: Number.isFinite(subtotal) ? subtotal : 0,
    tax_amount: Number.isFinite(tax_amount) ? tax_amount : 0,
    discount_amount: Number.isFinite(discount_amount) ? discount_amount : 0,
    total_amount: Number.isFinite(total_amount) ? total_amount : 0,
  }
}

/**
 * JSON shape the frontend expects for each line on GET /sales and GET /sales/:id.
 * Include aliases so older clients still work.
 */
export function serializeSaleItem(row, product = null) {
  const quantity = Number(row.quantity ?? 0)
  const unit_price = Number(row.unit_price ?? row.unitPrice ?? 0)
  const gst_rate = Number(row.gst_rate ?? row.gstRate ?? 0)
  const subtotal = Number(
    row.subtotal ??
      row.line_total ??
      (quantity > 0 && unit_price >= 0 ? quantity * unit_price : 0),
  )
  return {
    id: row.id,
    product_id: row.product_id || row.productId,
    product: product
      ? {
          id: product.id,
          name: product.name,
          model: product.model,
          unit_price: product.unit_price,
        }
      : row.product || undefined,
    product_name: product?.name || row.product_name || undefined,
    quantity,
    qty: quantity, // alias
    unit_price,
    rate: unit_price, // alias
    gst_rate,
    subtotal,
    line_total: subtotal,
    amount: subtotal,
    serial_numbers: row.serial_numbers || row.serialNumbers || [],
  }
}

export function serializeSale(sale, { items = [], productsById = new Map() } = {}) {
  const money = {
    subtotal: Number(sale.subtotal ?? 0),
    tax_amount: Number(sale.tax_amount ?? sale.taxAmount ?? 0),
    discount_amount: Number(sale.discount_amount ?? sale.discountAmount ?? 0),
    total_amount: Number(
      sale.total_amount ?? sale.totalAmount ?? sale.final_amount ?? 0,
    ),
  }
  if (!(money.total_amount > 0)) {
    money.total_amount = Math.max(
      0,
      money.subtotal + money.tax_amount - money.discount_amount,
    )
  }

  return {
    ...sale,
    ...money,
    totalAmount: money.total_amount,
    items: items.map((row) => {
      const pid = row.product_id || row.productId
      return serializeSaleItem(row, productsById.get(pid) || null)
    }),
  }
}

/**
 * Wire into POST /sales (pseudocode) — after §20 created_by + §21 stock deduct:
 *
 *   const t = await db.transaction()
 *   try {
 *     const itemRows = buildSaleItemRows(req.body)
 *     if (itemRows.length === 0) {
 *       return res.status(400).json({
 *         success: false,
 *         error: { code: "SALE_ITEMS_REQUIRED", message: "At least one item with quantity > 0 is required" },
 *       })
 *     }
 *
 *     await assertAndDeductSaleStock(req, { AdminInventory, Products, transaction: t }) // §21
 *     const created_by = await resolveInventoryCreatedBy(req, Users) // §20
 *     const money = resolveSaleMoneyFields(req.body, itemRows)
 *
 *     const sale = await Sales.create({
 *       type: req.body.type,
 *       customer_name: req.body.customer_name,
 *       customer_phone: req.body.customer_phone,
 *       company_name: req.body.company_name,
 *       gst_number: req.body.gst_number,
 *       notes: req.body.notes,
 *       admin_id: resolveSaleAdminId(req.body) || null,
 *       payment_status: "pending",
 *       approval_status: "pending",
 *       created_by,
 *       ...money,
 *     }, { transaction: t })
 *
 *     for (const line of itemRows) {
 *       await SaleItems.create({
 *         sale_id: sale.id,
 *         product_id: line.product_id,
 *         quantity: line.quantity,       // MUST persist — not 0
 *         unit_price: line.unit_price,   // MUST persist — not 0 (0 only if free)
 *         gst_rate: line.gst_rate,
 *         subtotal: line.subtotal,       // qty * unit_price (ex-GST) preferred
 *         serial_numbers: line.serial_numbers || null,
 *       }, { transaction: t })
 *     }
 *
 *     await t.commit()
 *     // Prefer returning full sale with items (same shape as GET /sales/:id)
 *     return res.status(201).json({ success: true, data: await loadSaleDetail(sale.id) })
 *   } catch (e) {
 *     await t.rollback()
 *     throw e
 *   }
 *
 * GET /sales and GET /sales/:id:
 *   Join/include SaleItems + Product
 *   Map each item through serializeSaleItem
 *   Never drop quantity / unit_price from the JSON
 *
 * Schema checklist (sale_items):
 *   product_id   UUID NOT NULL
 *   quantity     NUMERIC/DECIMAL NOT NULL  DEFAULT 0   ← must be written from body
 *   unit_price   NUMERIC/DECIMAL NOT NULL  DEFAULT 0   ← must be written from body
 *   gst_rate     NUMERIC/DECIMAL
 *   subtotal     NUMERIC/DECIMAL            ← line amount (ex-GST)
 *   Do NOT compute quantity as 0 when only storing amount.
 *
 * If an old code path only inserted product_id + amount:
 *   STOP doing that. Always copy quantity + unit_price from the request.
 */

/**
 * QA
 * ---
 * 1. Agent → New B2B Sale → add PIPE qty 2 @ ₹100 → Record Sale → 201
 * 2. GET /sales/:id → items[0].quantity === 2, unit_price === 100, subtotal === 200
 * 3. GET /sales (list) → same fields on each sale.items[] (or hydrate via detail)
 * 4. UI Sales History → View items → "Qty 2.00 × ₹100 = ₹200" (not 0 × ₹0)
 * 5. Tally / multi-line sale: every line keeps its own qty and rate
 * 6. Stock deduct (§21) uses the same persisted quantity
 */
