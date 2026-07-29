// @ts-nocheck
/**
 * =============================================================================
 * BACKEND REFERENCE — stock_requests.dispatched_by_id FK (Jul 2026)
 * =============================================================================
 *
 * Live error:
 *   insert or update on table "stock_requests" violates foreign key constraint
 *   "stock_requests_dispatched_by_id_fkey"
 *
 * Cause: Quotation Admin JWT id is a Dealer.id, not an inventory `users.id`.
 * POST /api/stock-requests/:id/dispatch was writing req.user.id directly.
 *
 * Implementation (shipped):
 *   utils/resolveInventoryCreatedBy.ts → resolveInventoryDispatchedBy()
 *   controllers/stockRequestController.ts → dispatchStockRequest (before update)
 *
 * Order (before updating stock_requests):
 *   1. body dispatched_by_id / dispatched_by / dispatchedById / dispatchedBy
 *      if that id exists in inventory users
 *   2. else if JWT id exists in inventory users → use it
 *   3. else upsert JWT user into inventory users, then use that id
 *   4. never write a JWT id that is not in users
 *   5. missing actor after resolve → 400 INV_USER_MISSING (not opaque 500 / raw FK)
 *
 * Upsert defaults (same idea as §14 products.created_by):
 *   {
 *     id: jwtId,
 *     username: req.user.username || `user_${jwtId.slice(0, 8)}`,
 *     name: req.user.name || req.user.username || "Quotation Admin",
 *     role: "super-admin",
 *     is_active: true,
 *   }
 *
 * Handoff: BACKEND_CHANGES_HANDOFF.md §16 (Review & Dispatch)
 *
 * QA:
 *   Quotation Admin → Review & Dispatch → 200, status dispatched
 *   Row dispatched_by_id exists in inventory users
 *   No stock_requests_dispatched_by_id_fkey
 */
