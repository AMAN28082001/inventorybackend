// @ts-nocheck
/**
 * =============================================================================
 * BACKEND REFERENCE — Customer Journey (Calling Data → Final Confirmation)
 * =============================================================================
 *
 * Frontend (Aug 2026):
 *   - Admin: `/dashboard/admin` → tab **Customer Journey**
 *   - Dealer: `/dashboard/customer-journey`
 *   - `lib/full-customer-journey.ts` — merge quotations + calling actions
 *   - `lib/journey-calling-actions.ts` — parse API payloads / mobile+lead match
 *   - `components/full-customer-journey-panel.tsx` — UI + filters modal
 *
 * Goal: each customer row shows stages with status + date/time:
 *   Calling Data → Calling Action → Quotation → Admin Approval →
 *   Installation → Metering → Final Confirmation
 *
 * Frontend does NOT invent calling completion. It marks **Calling Data** /
 * **Calling Action** Completed only when matching calling-action rows exist
 * from the backend (or dealer local cache fallback).
 *
 * -----------------------------------------------------------------------------
 * Problem observed
 * -----------------------------------------------------------------------------
 *
 * Quotation for mobile `9829756256` shows Quotation / Admin Approval /
 * Installation completed, but Calling Data + Calling Action stay **Pending**
 * with date "—". Root causes on backend are usually:
 *
 * 1. Dealer/Admin `GET .../calling-actions` omits older rows or wrong shape
 * 2. Action rows missing `mobile` / `leadId` so frontend cannot match quotation
 * 3. Quotation create from Calling Data Prefill does not persist `callingLeadId`
 * 4. Queue `GET .../calling-queue/current` does not include dialled/connected/recent
 *
 * -----------------------------------------------------------------------------
 * Endpoints (existing — harden / extend)
 * -----------------------------------------------------------------------------
 *
 * Dealer:
 *   GET /api/dealers/me/calling-actions?limit=2000&range=all
 *   GET /api/dealers/me/calling-queue/actions?limit=2000&range=all
 *   GET /api/dealers/calling-actions?limit=2000&range=all
 *   GET /api/dealers/me/calling-queue/current   (must include action buckets)
 *   GET /api/dealers/me/calling-queue/next
 *
 * Admin:
 *   GET /api/admin/calling-actions?limit=2000&range=all
 *   GET /api/admin/calling-queue/actions?limit=2000&range=all
 *   GET /api/admin/leads/actions?limit=2000&range=all
 *
 * Optional (recommended):
 *   GET /api/admin/customer-journey?search=&dealerId=&startDate=&endDate=&page=&limit=
 *   GET /api/dealers/me/customer-journey?search=&startDate=&endDate=&page=&limit=
 *
 * Auth: dealer JWT for dealer paths; admin for admin paths.
 *
 * -----------------------------------------------------------------------------
 * Required fields on EVERY calling-action row
 * -----------------------------------------------------------------------------
 *
 * Return camelCase (snake_case also accepted by frontend):
 *
 * | Field            | Required | Notes |
 * |------------------|----------|-------|
 * | `id`             | yes      | Stable action / history id |
 * | `leadId`         | yes      | Calling lead UUID |
 * | `mobile`         | yes      | Digits; prefer 10-digit Indian mobile |
 * | `name`           | yes      | Customer name |
 * | `dealerId`       | yes      | Assigned dealer |
 * | `dealerName`     | yes      | Display name |
 * | `action`         | yes      | `called` \| `follow_up` \| `not_interested` \| `rescheduled` \| `start` |
 * | `actionAt`       | yes      | ISO-8601 when action was submitted |
 * | `statusText`     | yes*     | e.g. "Call Unanswered", "Interested" |
 * | `statusCategory` | yes*     | e.g. `call_connectivity`, `customer_intent` |
 * | `callRemark`     | yes      | Tagged remark preferred |
 * | `nextFollowUpAt` | no       | ISO when scheduled |
 *
 * *If structured fields missing, frontend can parse tagged `callRemark`, but
 * backend SHOULD persist and echo `statusText` / `statusCategory`.
 *
 * Response shape (any of these arrays is accepted; prefer all buckets when present):
 *
 * ```json
 * {
 *   "success": true,
 *   "actions": [ /* preferred canonical list */ ],
 *   "callingActions": [],
 *   "recentActions": [],
 *   "actionHistory": [],
 *   "dialledActions": [],
 *   "connectedActions": [],
 *   "notConnectedActions": [],
 *   "pagination": { "page": 1, "limit": 2000, "total": 5400 }
 * }
 * ```
 *
 * Queue current/next MUST also include the same action bucket arrays so Customer
 * Journey can merge without a second round-trip when history endpoint is thin.
 *
 * -----------------------------------------------------------------------------
 * Quotation ↔ Calling lead link (required for reliable Complete status)
 * -----------------------------------------------------------------------------
 *
 * When dealer creates quotation from Calling Data (**Create Quotation Prefill**),
 * frontend sends `prefillLeadId` in the URL and should be persisted on create:
 *
 *   POST /api/quotations  (or whatever create path)
 *   body may include: callingLeadId | leadId | prefillLeadId
 *
 * Persist on quotation (recommended column):
 *   quotations.calling_lead_id  UUID NULL REFERENCES calling_leads(id)
 *
 * Echo on EVERY quotation list/detail GET:
 *   callingLeadId / calling_lead_id
 *
 * Frontend match order:
 *   1) quotation.callingLeadId === action.leadId
 *   2) last-10 digits of quotation.customer.mobile === action.mobile
 *
 * Without (1), mobile-only match fails when formats differ or history is missing.
 *
 * -----------------------------------------------------------------------------
 * Search
 * -----------------------------------------------------------------------------
 *
 * Frontend searches locally by name / mobile digits / quotation id / lead id.
 * For large datasets, backend should support:
 *
 *   GET .../calling-actions?search=9829756256&limit=2000
 *   GET .../customer-journey?search=9829756256
 *
 * Search rules:
 *   - Match name ILIKE
 *   - Match mobile digits (strip non-digits; compare last 10)
 *   - Match leadId / quotationId exact or prefix
 *
 * -----------------------------------------------------------------------------
 * Stage date sources (quotation side — already partly required)
 * -----------------------------------------------------------------------------
 *
 * | Stage              | Preferred fields |
 * |--------------------|------------------|
 * | Calling Data       | earliest matching `actionAt` |
 * | Calling Action     | latest matching `actionAt` |
 * | Quotation          | `createdAt` |
 * | Admin Approval     | `statusApprovedAt` / statusHistory approved |
 * | Installation       | `installerApprovedAt` / `installationReleasedAt` |
 * | Metering           | `meteringApprovedAt` / `mcoAt` |
 * | Final Confirmation | `baldevApprovedAt` / statusHistory completed |
 *
 * Keep returning workflow timestamps on admin + dealer quotation lists.
 *
 * -----------------------------------------------------------------------------
 * Optional dedicated Customer Journey API (recommended for scale)
 * -----------------------------------------------------------------------------
 *
 * GET /api/admin/customer-journey
 * GET /api/dealers/me/customer-journey
 *
 * Query: page, limit, search, dealerId (admin), startDate, endDate,
 *        source=calling_data|not_calling_data|all,
 *        connection=connected|not_connected|all,
 *        outcome=interested|followUp|notInterested|others|all
 *
 * Each row:
 * ```json
 * {
 *   "id": "QT-… or lead-…",
 *   "customerName": "…",
 *   "customerMobile": "9829756256",
 *   "dealerId": "…",
 *   "dealerName": "…",
 *   "quotationId": "QT-…",
 *   "leadId": "…",
 *   "stages": {
 *     "callingData": "completed",
 *     "callingAction": "completed",
 *     "quotation": "completed",
 *     "adminApproval": "completed",
 *     "installation": "completed",
 *     "metering": "pending",
 *     "finalConfirmation": "pending"
 *   },
 *   "stageDates": {
 *     "callingData": "2026-06-01T10:00:00.000Z",
 *     "callingAction": "2026-06-01T10:05:00.000Z",
 *     "quotation": "2026-06-10T06:17:00.000Z",
 *     "adminApproval": "2026-07-31T05:52:00.000Z",
 *     "installation": "2026-08-18T09:38:00.000Z"
 *   },
 *   "timeline": [
 *     { "at": "…", "label": "Connected · Interested", "source": "calling" }
 *   ]
 * }
 * ```
 *
 * Stage status values: `pending` | `in_progress` | `completed`
 *
 * Calling stage rules (must match frontend `callingStagesFromActions`):
 *   - no action rows → callingData=pending, callingAction=pending
 *   - action=`start` only → callingData=completed, callingAction=in_progress
 *   - follow_up / rescheduled → callingData=completed, callingAction=in_progress
 *   - any submitted outcome → both completed
 *
 * -----------------------------------------------------------------------------
 * SQL sketch
 * -----------------------------------------------------------------------------
 *
 * -- Persist link on quotation create from Calling Data
 * ALTER TABLE quotations
 *   ADD COLUMN IF NOT EXISTS calling_lead_id UUID NULL;
 * CREATE INDEX IF NOT EXISTS idx_quotations_calling_lead_id
 *   ON quotations (calling_lead_id);
 *
 * -- Calling actions list for journey (dealer scoped)
 * SELECT
 *   a.id,
 *   a.lead_id AS "leadId",
 *   l.mobile,
 *   l.name,
 *   a.assigned_dealer_id AS "dealerId",
 *   a.action,
 *   a.action_at AS "actionAt",
 *   a.call_remark AS "callRemark",
 *   a.status_category AS "statusCategory",
 *   a.status_text AS "statusText",
 *   a.next_follow_up_at AS "nextFollowUpAt"
 * FROM calling_actions a
 * JOIN calling_leads l ON l.id = a.lead_id
 * WHERE a.assigned_dealer_id = :dealerId
 * ORDER BY a.action_at DESC
 * LIMIT :limit;
 *
 * -- Match quotation to calling history
 * SELECT q.*, a.*
 * FROM quotations q
 * LEFT JOIN calling_leads l
 *   ON l.id = q.calling_lead_id
 *   OR RIGHT(regexp_replace(COALESCE(q.customer_mobile, ''), '\\D', '', 'g'), 10)
 *      = RIGHT(regexp_replace(COALESCE(l.mobile, ''), '\\D', '', 'g'), 10)
 * LEFT JOIN calling_actions a ON a.lead_id = l.id;
 *
 * -----------------------------------------------------------------------------
 * Checklist
 * -----------------------------------------------------------------------------
 *
 * - [ ] GET dealer + admin calling-actions returns full history (`range=all`, high limit)
 * - [ ] Every action row has `leadId`, `mobile`, `actionAt`, `action`, remark/status fields
 * - [ ] Queue GET includes dialled/connected/notConnected/recentActions arrays
 * - [ ] Quotation create stores `callingLeadId` from Calling Data prefill
 * - [ ] Quotation list/detail echoes `callingLeadId`
 * - [ ] Mobile search works with last-10 digit compare
 * - [ ] QA: mobile with completed quotation + prior call shows Calling Data/Action Completed
 *
 * -----------------------------------------------------------------------------
 * QA
 * -----------------------------------------------------------------------------
 *
 * 1. From Calling Data, submit a call, then Create Quotation Prefill → save.
 * 2. Open Customer Journey, search customer mobile.
 * 3. Expect Calling Data + Calling Action **Completed** with `actionAt` dates.
 * 4. Expect Quotation date = `createdAt`.
 * 5. Admin Customer Journey → same mobile → same calling stages + dealer name.
 * 6. Filters modal: dealer / calling data / connected / outcome still work.
 */
export {}
