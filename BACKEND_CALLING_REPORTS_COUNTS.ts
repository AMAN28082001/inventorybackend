// @ts-nocheck
/**
 * =============================================================================
 * BACKEND — Admin Calling Reports counts (date filter) — Aug 2026
 * =============================================================================
 *
 * UI: Admin → Calling Reports → Employee Calling Actions
 * Cards: Total Calls, Not Connected, Connected, Connected — Not Interested /
 *        Interested / Follow Up
 *
 * Frontend: `app/dashboard/admin/page.tsx` (`loadCallingActionsForReports`),
 *           `lib/calling-report-date-range.ts`, `lib/calling-action-summary.ts`
 * Docs: REQUIRED §AI, HANDOFF §37 (FE HANDOFF §36), also §J / HANDOFF §4.8
 *
 * Symptom:
 *   Monthly/Weekly Total Calls stuck at 1000 or does not match the selected
 *   date filter (cards show all-time or a page cap).
 *
 * Cause:
 *   GET calling-actions ignores `range` / `startDate` / `endDate`, hard-caps
 *   `limit=1000`, filters on lead `created_at` instead of `action_at`,
 *   includes `action=start`, returns duplicate rows, or omits `pagination.total`.
 *
 * =============================================================================
 */

/**
 * GET /api/admin/calling-actions
 * Fallbacks: /api/admin/calling-queue/actions, /api/admin/leads/actions
 * Same contract for HR: /api/hr/calling-actions
 *
 * Query (frontend sends all of these for presets):
 *   range     = daily | weekly | monthly | last_month | custom | all
 *   startDate = ISO-8601 inclusive (action_at)
 *   endDate   = ISO-8601 inclusive (action_at)
 *   fromDate  = YYYY-MM-DD local calendar start (optional alias)
 *   toDate    = YYYY-MM-DD local calendar end
 *   dealerId  = UUID (optional)
 *   page      = 1-based
 *   limit     = page size (frontend uses 250)
 *
 * Filter SQL (required):
 *   WHERE action_at >= :startDate AND action_at <= :endDate
 *   -- use action_at / submitted_at, NEVER lead.created_at
 *   AND (:dealerId IS NULL OR dealer_id = :dealerId)
 *   AND LOWER(action) <> 'start'          -- Start Call is not a completed call
 *
 * Weekly: Monday 00:00 through Sunday 23:59:59.999 in Asia/Kolkata (document TZ).
 * Monthly: first day 00:00 through last day 23:59:59.999 of current calendar month.
 *
 * Pagination (required):
 *   Honour page + limit. Do not ignore page (returning the same first page
 *   inflates client counts).
 *
 *   pagination.total = COUNT(*) of the FILTERED set (after date + dealer +
 *   exclude start), not the unfiltered table size.
 *
 * Response:
 * {
 *   "success": true,
 *   "actions": [ { id, leadId, dealerId, dealerName, action, actionAt,
 *                  callRemark, statusText, statusCategory, mobile, customerName } ],
 *   "pagination": { "page": 1, "limit": 250, "total": 187 }
 * }
 *
 * actionAt: ISO-8601 UTC on every row (e.g. 2026-08-25T12:03:00.000Z).
 * id: stable UUID per submit (not regenerated per page).
 *
 * Recommended: one row per submitted outcome. If history has many updates per
 * lead, either return only the latest in-range row per lead_id, or expose
 * summary (below) so cards are exact without the client collapsing rows.
 */

/**
 * Optional fast path for the six cards (same filters, no full list):
 *
 * GET /api/admin/calling-actions/summary?range=monthly&startDate=&endDate=&dealerId=
 *
 * Counts must use the SAME filter as the list (action_at, exclude start,
 * optional latest-per-lead).
 *
 * {
 *   "data": {
 *     "totalCalls": 187,
 *     "connected": 88,
 *     "notConnected": 99,
 *     "connectedNotInterested": 50,
 *     "connectedInterested": 10,
 *     "connectedFollowUp": 28
 *   }
 * }
 *
 * Classification (match lib/calling-action-summary.ts):
 *   notConnected: status in Call Unanswered / Switched Off / … or action=start
 *   connected: submitted outcome with a connected status
 *   connectedNotInterested / Interested / Follow Up: from statusText / action
 *   totalCalls = connected + notConnected
 */

export function callingReportsWhere(params) {
  return {
    from: params.startDate || params.fromDate,
    to: params.endDate || params.toDate,
    dealerId: params.dealerId || null,
    excludeStart: true,
  }
}
