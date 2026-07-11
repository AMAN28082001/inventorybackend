// @ts-nocheck
/**
 * =============================================================================
 * BACKEND REFERENCE — Super Admin on Quotation Admin Login + Inventory data
 * =============================================================================
 *
 * Spec: BACKEND_CHANGES_REQUIRED.md §AD (+ §AD.5.1)
 * Handoff: BACKEND_CHANGES_HANDOFF.md §12b (Jul 2026)
 *
 * Frontend: /login → Admin Panel → Accounts → Open Inventory (/dashboard/inventory)
 *   lib/admin-access.ts, lib/auth-context.tsx → login()
 *
 * Goal:
 * - POST /api/auth/login accepts inventory `users` with role super-admin
 * - Response + JWT claim use canonical role: "super-admin"
 *   (normalize superadmin / super_admin)
 * - Same Bearer token works on /api/admin/* AND inventory routes
 * - Quotation Admin (Dealer.role === "admin") JWT also works on inventory routes
 *   especially GET /users and GET /users/agents (§AD.5.1)
 * - Do NOT require username === "admin"
 * - Super-admin / quotation Admin see full inventory user directory for the panel
 *
 * Implementation:
 * - utils/inventoryRole.ts → normalizeInventoryRole, isInventoryAdminLikeRole
 * - controllers/quotationAuthController.ts → login (User fallback)
 * - middleware/authQuotation.ts → authenticate + authorizeAdmin
 * - middleware/auth.ts → tryAuthenticateInventoryUser
 *                     → tryAuthenticateQuotationAdminForInventory (§AD.5.1)
 * - controllers/userController.ts → getAllUsers (quotation-admin full scope)
 */

/**
 * AD.5.1 Known SPA error: `Invalid token or user inactive` on GET /users
 *
 * Cause: GET /products is public (no auth). GET /users uses middleware/auth.ts
 * which only loaded inventory `users` by JWT id. Quotation Admin JWT id is a
 * Dealer id → User.findByPk fails → 401 "Invalid token or user inactive".
 *
 * Fix: After inventory User lookup fails, accept Dealer with role "admin"
 * (isActive=true). Set req.user.role = "super-admin", authSource = "quotation-admin"
 * so quotation Admin has the SAME inventory access as Super Admin (users, products,
 * stock-requests, sales, stock-returns, admin-inventory, etc.).
 *
 * Quotation Admin already logged in:
 * - Reuse the same Bearer from POST /api/auth/login
 * - Do NOT require POST /api/inventory-auth/login again
 * - GET /api/inventory-auth/me returns role super-admin + requiresInventoryLogin: false
 */

/**
 * Example login — super-admin (inventory users table)
 *
 * POST /api/auth/login
 * { "username": "superadmin", "password": "..." }
 *
 * {
 *   "success": true,
 *   "data": {
 *     "token": "<jwt>",
 *     "user": { "role": "super-admin", ... }
 *   }
 * }
 */

/**
 * Example login — quotation Admin (dealers table, role admin)
 *
 * POST /api/auth/login
 * { "username": "admin", "password": "..." }
 *
 * JWT: { id: <dealerId>, role: "admin" }
 * Must work on GET /api/users and GET /api/users/agents.
 */

/**
 * Curl QA — quotation Admin
 *
 * ADMIN_TOKEN=$(curl -s -X POST https://api.inventory.chairbordsolar.com/api/auth/login \
 *   -H 'Content-Type: application/json' \
 *   -d '{"username":"<quotation-admin>","password":"..."}' | jq -r '.data.token')
 *
 * curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $ADMIN_TOKEN" \
 *   https://api.inventory.chairbordsolar.com/api/users
 * # expect 200 (not 401 Invalid token or user inactive)
 *
 * curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
 *   'https://api.inventory.chairbordsolar.com/api/users?role=admin' | jq 'length'
 *
 * curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
 *   https://api.inventory.chairbordsolar.com/api/users/agents | jq 'length'
 */

/**
 * Curl QA — super-admin
 *
 * TOKEN=$(curl -s -X POST .../api/auth/login -d '{"username":"superadmin",...}' | jq -r '.data.token')
 * # body.user.role === "super-admin"
 * curl -s -H "Authorization: Bearer $TOKEN" .../api/admin/quotations | jq '.success'
 * curl -s -H "Authorization: Bearer $TOKEN" .../api/users?role=admin | jq 'length'
 */

export {};
