// @ts-nocheck
/**
 * =============================================================================
 * BACKEND REFERENCE — Drain Unassigned → Assigned (Jul 2026)
 * =============================================================================
 *
 * Handoff: BACKEND_CHANGES_HANDOFF.md §15-C
 * Shipped:
 *   POST /api/hr/leads/uploads/:uploadId/assign-unassigned
 *   POST /api/hr/uploads/:uploadId/assign-unassigned
 *   POST /api/hr/calling-uploads/:uploadId/assign-unassigned
 *   controllers/callingLeadController.ts → assignHrUploadUnassigned
 *   upload CSV honors assignmentMode=round_robin_all
 *
 * Dealer empty Current Lead (Harshita) fix:
 *   buildCallableQueue returns THIS dealer's assigned/in_progress WITHOUT
 *   batch-pool eligibility filter. Eligibility only gates pool claim.
 *   GET /current|/next return lead at root AND under data (SPA compat).
 *
 * Pool FK fix (Jul 2026):
 *   dealers row id="unassigned" must exist — assignments.dealerId has FK.
 *   ensureCallingPoolDealerExists() runs before reclaim/upload/assign-unassigned.
 *   HR counts use live calling_leads count (not CSV rowCount) so Unassigned is not phantom.
 *
 * Duplicate mobiles (Jul 2026):
 *   Existing mobiles in a new CSV are adopted into the upload batch and round-robin
 *   assigned to dealers when not already actively held (assigned/in_progress).
 *   assign-unassigned also adopts duplicate audit rows the same way.
 *
 * Related: BACKEND_CALLING_QUEUE_CURRENT.ts
 */
