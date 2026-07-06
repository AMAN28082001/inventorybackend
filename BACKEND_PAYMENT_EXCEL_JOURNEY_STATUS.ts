/**
 * Payment Excel — Customer Journey columns (Account Management)
 *
 * Export is **client-side CSV**. Backend must return workflow fields on
 * `GET /api/quotations?status=approved` so Excel columns are accurate after refresh.
 *
 * Implementation:
 * - utils/paymentExcelJourneyStatus.ts — journeyStageProgress + fileStatus labels
 * - utils/meteringWorkflowApi.ts — meteringStatus / meteringStage / mcoStatus
 * - controllers/quotationController.ts — getQuotations, getQuotationById
 *
 * No new endpoint required.
 */

// --- Required list-row fields ---
/*
| Field | Purpose |
|-------|---------|
| status | Admin Approval stage |
| installationStatus / installation_status | Installation stage + File Status |
| meteringStatus / meteringStage / mcoStatus | Metering stage |
| installments / paymentPhases / payment_phases | Installment Count column |
*/

// --- Excel columns (end of CSV) ---
/*
1. Installment Count        → installments.length
2. Admin Approval Status    → status / adminApprovalStatus
3. Installation Status      → installationStatus / installationStatusLabel
4. Metering Status          → meteringStatus / meteringStatusLabel
5. Final Confirmation Status → finalConfirmationStatusLabel (baldev pipeline)
6. File Status (last)       → fileStatus (derived)
*/

// --- Optional pre-computed (implemented on GET) ---
/*
{
  "journeyStageProgress": {
    "adminApproval": "completed",
    "installation": "in_progress",
    "metering": "not_started",
    "finalConfirmation": "not_started"
  },
  "fileStatus": "Pending Metering"
}
*/

// --- SQL / Sequelize ---
// `quotations.installationStatus` is the source of truth for installation + metering derivation.
// `quotation_payment_phases` rows power installment count (not JSON on quotations).
// Ensure approved-list query SELECT includes `installationStatus`, `fileLoginStatus`, `status`.

// --- QA ---
// 1. Approved row with pending_metering → meteringStatus = pending_metering, fileStatus includes Metering
// 2. Row missing installationStatus in API → Excel shows Workflow Pending (bug — must echo field)
// 3. After installation workflow update → hard refresh → Excel columns match UI journey panel
// 4. installments.length matches PATCH save count

export {};
