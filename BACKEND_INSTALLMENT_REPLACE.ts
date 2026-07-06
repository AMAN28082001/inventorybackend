/**
 * Installment replace-on-save — backend reference (Account Management)
 *
 * Problem: Removing installments and submitting caused deleted rows to reappear on refresh
 * because the API upserted by phase_number only (orphan rows remained).
 *
 * Fix: When `replaceInstallments: true`, `replace: true`, or `PUT /installments` is used,
 * delete all `quotation_payment_phases` for the quotation and insert only the request array
 * (including `phases: []` to clear all).
 *
 * Implementation:
 * - utils/quotationPaymentPhases.ts — shouldReplacePaymentPhases, replaceQuotationPaymentPhases
 * - controllers/quotationController.ts — updateQuotationPaymentDetails
 * - routes/quotationRoutes.ts — PUT/PATCH installments, PATCH payment-details
 */

// --- Endpoints (frontend try order) ---
// 1. PUT  /api/quotations/{id}/installments
// 2. PATCH /api/quotations/{id}/payment-details
// 3. PATCH /api/quotations/{id}/installments
//
// Auth: account-management or admin (inventory admin / quotation dealer admin)
// Quotation: status must be approved

// --- Request body ---
/*
{
  "replaceInstallments": true,
  "replace": true,
  "phases": [ ...full list after remove... ],
  "installments": [ ...alias... ],
  "paymentPhases": [ ...alias... ],
  "paymentStatus": "partial",
  "paymentMode": "loan"
}
*/

// phases: []  →  clear all installments (DELETE all rows, 0 INSERTs)

// --- Replace detection (shouldReplacePaymentPhases) ---
// - req.method === 'PUT'
// - body.replaceInstallments === true
// - body.replace === true
// - path includes '/installments' (PATCH installments always replaces)

// PATCH /payment-details without replace flags uses legacy upsert (backward compat).
// PATCH /installation-release does NOT touch installments.

// --- DB logic (relational) ---
/*
BEGIN;
  DELETE FROM quotation_payment_phases WHERE "quotationId" = :id;
  INSERT INTO quotation_payment_phases (...) VALUES (...); -- 0..N rows from body.phases
  UPDATE quotations SET
    "paidAmount" = SUM(paid),
    "remainingAmount" = subtotal - SUM(paid),
    "paymentStatus" = ...,
    "paymentPhases" = JSON snapshot;
COMMIT;
*/

// --- GET read-after-write ---
// GET /api/quotations?status=approved
// GET /api/quotations/{id}
// Must return installments / paymentPhases / payment_phases with exact saved row count.

// --- QA ---
// 1. 3 installments → save 2 → GET returns 2 rows
// 2. phases: [] → GET returns 0 rows
// 3. Hard refresh — count unchanged
// 4. PATCH /installation-release with only installationReadyForInstaller — installments unchanged

export {};
