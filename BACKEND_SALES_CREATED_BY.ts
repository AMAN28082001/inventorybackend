// @ts-nocheck
/**
 * =============================================================================
 * BACKEND REFERENCE — Fix sales_created_by_fkey on POST /sales (Jul 2026)
 * =============================================================================
 *
 * Handoff: BACKEND_CHANGES_HANDOFF.md §20
 * Related: BACKEND_PRODUCTS_CREATED_BY.ts, BACKEND_STOCK_REQUESTS_DISPATCHED_BY.ts
 *          (same root cause / same resolver)
 *
 * Frontend:
 *   - Quotation Admin → Inventory → Agent → New B2B / B2C Sale → Record Sale
 *   - SPA sends created_by / createdBy / created_by_id / createdById
 *     (valid inventory users.id when resolvable; retries with fallback on FK)
 *
 * Live error:
 *   insert or update on table "sales" violates foreign key constraint
 *   "sales_created_by_fkey"
 *
 * Cause:
 *   POST /sales sets sales.created_by = jwt.sub / req.user.id
 *   Quotation Admin JWT id is NOT in inventory `users` → FK fails.
 *
 * Implementation (shipped):
 *   utils/resolveInventoryCreatedBy.ts → resolveInventorySaleCreatedBy()
 *   controllers/salesController.ts → createSale (before Sale.create)
 *
 * Order:
 *   1. body created_by / createdBy / created_by_id / createdById (if in users)
 *   2. JWT id if in users
 *   3. upsert JWT user into inventory users, then set created_by
 *   4. never INSERT with a bare JWT id missing from users
 *   5. missing actor → 400 INV_USER_MISSING (not opaque 500 / raw PG FK)
 *
 * Upsert defaults (same as §14 / §16):
 *   {
 *     id: jwtId,
 *     username: req.user.username || `user_${jwtId.slice(0, 8)}`,
 *     name: req.user.name || req.user.username || "Quotation Admin",
 *     role: "super-admin",
 *     is_active: true,
 *   }
 *
 * QA:
 *   1. Quotation Admin → Agent → New B2B Sale → Record Sale → 201
 *   2. sales.created_by JOIN users → 1 row
 *   3. No sales_created_by_fkey
 *   4. Body created_by with valid users.id accepted when JWT missing
 *   5. After first success, users row exists for jwt-sub (upsert path)
 */
