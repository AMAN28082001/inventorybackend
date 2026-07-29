// @ts-nocheck
/**
 * =============================================================================
 * BACKEND REFERENCE — Agent sale uses admin_inventory, not central (Jul 2026)
 * =============================================================================
 *
 * Handoff: BACKEND_CHANGES_HANDOFF.md §21
 * Related: BACKEND_SALES_CREATED_BY.ts
 *
 * Frontend:
 *   Inventory → Agent → Sell from admin (e.g. CHAIRBORD HEAD OFFICE) → Record Sale
 *   UI checks admin_inventory Available > 0 and sends:
 *     admin_id | adminId | sell_from_admin_id | stock_admin_id
 *     and/or stock_source: "admin" | use_admin_stock: true
 *
 * Live error (before fix):
 *   "Insufficient central inventory for sale"
 *
 * Cause:
 *   Zod stripped adminId aliases; POST /sales fell through to products.quantity
 *   (central) even when SPA selected an admin warehouse with stock.
 *
 * Implementation (shipped):
 *   validations/salesValidations.ts — keep admin_* aliases (+ passthrough)
 *   controllers/salesController.ts — parse aliases, deduct admin_inventory only
 *   models/Sale.ts + migration — persist sales.admin_id
 *
 * Logic:
 *   if adminId || use_admin_stock || stock_source === "admin":
 *     check + deduct admin_inventory(admin_id, product_id)
 *     never touch products.quantity / central_stock
 *     save sale.admin_id
 *     short → 400 INSUFFICIENT_ADMIN_STOCK
 *   else:
 *     existing central_stock check / deduct
 *
 * QA:
 *   Admin Available 130, central 0 → Record Sale → 201
 *   admin_inventory decreases; products.quantity unchanged
 *   Sale without admin_id still uses central rules
 */
