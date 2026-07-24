// @ts-nocheck
/**
 * =============================================================================
 * BACKEND REFERENCE — Calling queue /current + /next (Jul 2026 §15)
 * =============================================================================
 *
 * Live blocker (fixed):
 *   GET /calling-queue/current → was 500; dealers with Assigned>0 saw empty Current Lead.
 *
 * Root cause (Harshita):
 *   buildCallableQueue filtered by batch assignedDealers JSON eligibility, hiding
 *   rows already assigned to the dealer. Fix: return dealer-owned assigned/in_progress
 *   first WITHOUT eligibility; eligibility only for pool claim.
 *
 * Shipped:
 *   getDealerCallingQueueCurrent / Next — always 200; lead at root + data
 *   Aliases: /me/lead-queue/next|current
 *   assign-unassigned: see BACKEND_ASSIGN_UNASSIGNED.ts
 *
 * Handoff: BACKEND_CHANGES_HANDOFF.md §15
 */
