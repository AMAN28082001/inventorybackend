// @ts-nocheck
/**
 * =============================================================================
 * BACKEND REFERENCE — products.created_by FK (Jul 2026)
 * =============================================================================
 *
 * Live error:
 *   insert or update on table "products" violates foreign key constraint
 *   "products_created_by_fkey"
 *
 * Cause: Quotation Admin JWT id is a Dealer.id, not an inventory `users.id`.
 *
 * Implementation (shipped):
 *   utils/resolveInventoryCreatedBy.ts → resolveInventoryCreatedBy()
 *   controllers/productController.ts → createProduct uses it before Product.create
 *
 * Order:
 *   1. jwt.sub / actor.id in users
 *   2. body created_by / createdBy in users
 *   3. same username in users
 *   4. upsert users row id=jwt.sub role=super-admin
 *   5. fall back to any active super-admin
 *   6. else 400 INV_USER_MISSING
 *
 * Handoff: BACKEND_CHANGES_HANDOFF.md §14
 */
