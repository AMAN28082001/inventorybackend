import express, { Router } from 'express';
import {
  getAllQuotations,
  getAdminQuotationById,
  updateQuotationStatus,
  updateQuotationInstallationStatus,
  sendQuotationToMetering,
  updateMeteringWccAfterDiscom,
  updateQuotationBankProcess,
  updateQuotationFileLogin,
  getAllDealers,
  updateDealer,
  activateDealer,
  getSystemStatistics,
  getAdminProductNeeded
} from '../controllers/adminController';
import {
  updateQuotationInstallationRelease,
  updateQuotationInstallationScheduledAt,
  updateQuotationPaymentDetails,
  saveFinalConfirmationDocuments,
  uploadQuotationDocument
} from '../controllers/quotationController';
import {
  handleFinalConfirmationDocumentsMultipart,
  handleSingleQuotationDocumentUpload
} from './quotationRoutes';
import {
  createVisitor,
  getAllVisitors,
  getVisitorById,
  updateVisitor,
  updateVisitorPassword,
  deleteVisitor
} from '../controllers/adminVisitorController';
import { getAdminCallingActions, getAdminCallingActionsSummary, getHrLeadUploadBatchRows, assignHrUploadUnassigned } from '../controllers/callingLeadController';
import { assignUnassignedLeadsSchema } from '../validations/callingLeadValidations';
import {
  listInstallationTeams,
  createInstallationTeam,
  patchInstallationTeam,
  patchInstallationTeamPassword,
  deleteInstallationTeam,
  patchQuotationInstallationTeam
} from '../controllers/installationTeamController';
import {
  authenticate,
  authorizeAdmin,
  authorizeDealerOrAccountManager,
  authorizeMeteringOrAdmin
} from '../middleware/authQuotation';
import { validate } from '../middleware/validate';
import { handleInstallerMultipart, handleSingleInstallerUploadMultipart } from './installerRoutes';
import { installerUploadDocuments, meteringStatusUpdate, uploadInstallerDocument } from '../controllers/workflowController';
import { meteringStatusSchema } from '../validations/workflowValidations';
import { installerUploadMetaSchema } from '../validations/workflowValidations';
import {
  updateStatusSchema,
  updateInstallationStatusSchema,
  sendToMeteringSchema,
  meteringWccAfterDiscomSchema,
  bankProcessSchema,
  fileLoginSchema,
  createVisitorSchema,
  updateVisitorSchema,
  updateVisitorPasswordSchema,
  createInstallationTeamSchema,
  patchInstallationTeamSchema,
  patchQuotationInstallationTeamSchema,
  patchInstallationTeamPasswordSchema
} from '../validations/adminValidations';
import {
  updateInstallationReleaseSchema,
  updateInstallationScheduledAtSchema,
  updatePaymentDetailsSchema
} from '../validations/quotationValidations';
import { adminUpdateDealerSchema } from '../validations/dealerValidations';
import { getAdminVisits } from '../controllers/visitController';

const router: Router = express.Router();

/** §30 — body is Cost-of-site only (no bank-process fields). */
function isSiteCostOnlyPaymentDetailsBody(body: Record<string, unknown> | null | undefined): boolean {
  if (!body || typeof body !== 'object') return false;
  const hasSite =
    body.siteCost !== undefined ||
    body.site_cost !== undefined ||
    body.costOfSite !== undefined ||
    body.cost_of_site !== undefined;
  if (!hasSite) return false;
  const hasBank =
    body.bankProcessDone !== undefined ||
    body.bank_process_done !== undefined ||
    body.bankName !== undefined ||
    body.bank_name !== undefined ||
    body.bankIfsc !== undefined ||
    body.bank_ifsc !== undefined ||
    body.moveToPendingPayment !== undefined ||
    body.move_to_pending_payment !== undefined;
  return !hasBank;
}

// All routes require authentication
router.use(authenticate);

/**
 * @swagger
 * /api/admin/quotations:
 *   get:
 *     summary: Get all quotations (admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get('/quotations', getAllQuotations);
router.get('/quotations/:quotationId', getAdminQuotationById);

/**
 * §17 Metering dual-track — WCC flag + bank process.
 * Accessible to admin / metering / installer (Installer → Metering tab).
 * Must stay before `authorizeAdmin` so installer JWTs are not AUTH_004'd.
 */
router.patch(
  '/quotations/:quotationId/metering-wcc-after-discom',
  authorizeMeteringOrAdmin,
  validate(meteringWccAfterDiscomSchema),
  updateMeteringWccAfterDiscom
);
router.patch(
  '/quotations/:quotationId/bank-process',
  authorizeMeteringOrAdmin,
  validate(bankProcessSchema),
  updateQuotationBankProcess
);
/**
 * §17 Bank process OR §30 siteCost-only (FE tries this path as Cost-of-site fallback).
 * Site-cost-only → payment-details handler (does not wipe installments).
 * Otherwise → bank process (metering / admin / installer).
 */
router.patch('/quotations/:quotationId/payment-details', (req, res) => {
  if (isSiteCostOnlyPaymentDetailsBody(req.body as Record<string, unknown>)) {
    return authorizeDealerOrAccountManager(req, res, () => {
      validate(updatePaymentDetailsSchema)(req, res, () => {
        void updateQuotationPaymentDetails(req, res);
      });
    });
  }
  return authorizeMeteringOrAdmin(req, res, () => {
    validate(bankProcessSchema)(req, res, () => {
      void updateQuotationBankProcess(req, res);
    });
  });
});

/** §30 optional alias — Account Management Cost of site (hard refresh / multi-device). */
router.patch(
  '/quotations/:quotationId/site-cost',
  authorizeDealerOrAccountManager,
  validate(updatePaymentDetailsSchema),
  updateQuotationPaymentDetails
);

/**
 * Admin Visitor Reports — all visits (admin / super-admin only).
 * Fallback for frontend: GET /api/visits when quotation dealer JWT has role=admin.
 */
router.get('/visits', authorizeAdmin, getAdminVisits);

// All routes below require admin authorization
router.use(authorizeAdmin);

/**
 * Admin Product Needed — installation-pending brand / wattage aggregates.
 * GET /api/admin/product-needed?scope=installation_pending
 */
router.get('/product-needed', getAdminProductNeeded);

/**
 * @swagger
 * /api/admin/quotations/{quotationId}/status:
 *   patch:
 *     summary: Update quotation status (admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.patch('/quotations/:quotationId/status', validate(updateStatusSchema), updateQuotationStatus);

/**
 * Installer completion multipart (same as POST /api/installer/quotations/:id/documents).
 * Admin UI tries these URLs before POST /api/quotations/:id/documents — that route uses KYC-only Multer
 * and rejects `installerCompletionImages` with "Unexpected or too many file fields".
 */
router.post(
  '/quotations/:quotationId/documents',
  handleInstallerMultipart,
  validate(installerUploadMetaSchema),
  installerUploadDocuments
);
router.post(
  '/quotations/:quotationId/installer-documents',
  handleInstallerMultipart,
  validate(installerUploadMetaSchema),
  installerUploadDocuments
);
router.post(
  '/installer/quotations/:quotationId/documents',
  handleInstallerMultipart,
  validate(installerUploadMetaSchema),
  installerUploadDocuments
);
router.post(
  '/quotations/:quotationId/installer-documents/upload',
  handleSingleInstallerUploadMultipart,
  uploadInstallerDocument
);
router.post(
  '/quotations/:quotationId/documents/upload',
  handleSingleInstallerUploadMultipart,
  uploadInstallerDocument
);

/** §M — Final confirmation document uploads (admin / baldev; not KYC PATCH). */
router.post(
  '/quotations/:quotationId/final-confirmation-documents',
  handleFinalConfirmationDocumentsMultipart,
  saveFinalConfirmationDocuments
);
router.post(
  '/quotations/:quotationId/final-confirmation-documents/upload',
  handleSingleQuotationDocumentUpload,
  uploadQuotationDocument
);

router.patch('/quotations/:quotationId/installation-status', validate(updateInstallationStatusSchema), updateQuotationInstallationStatus);
router.patch(
  '/quotations/:quotationId/send-to-metering',
  validate(sendToMeteringSchema),
  sendQuotationToMetering
);
router.post(
  '/quotations/:quotationId/send-to-metering',
  validate(sendToMeteringSchema),
  sendQuotationToMetering
);
router.patch(
  '/quotations/:quotationId/installation-release',
  validate(updateInstallationReleaseSchema),
  updateQuotationInstallationRelease
);
router.patch('/quotations/:quotationId/workflow-status', validate(updateInstallationStatusSchema), updateQuotationInstallationStatus);
router.patch(
  '/quotations/:quotationId/metering-status',
  validate(meteringStatusSchema),
  meteringStatusUpdate
);
router.patch('/quotations/:quotationId/installation-scheduled-at', validate(updateInstallationScheduledAtSchema), updateQuotationInstallationScheduledAt);
router.patch('/quotations/:quotationId/installation-schedule', validate(updateInstallationScheduledAtSchema), updateQuotationInstallationScheduledAt);
router.patch('/quotations/:quotationId/file-login', validate(fileLoginSchema), updateQuotationFileLogin);
router.patch(
  '/quotations/:quotationId/installation-team',
  validate(patchQuotationInstallationTeamSchema),
  patchQuotationInstallationTeam
);
router.patch(
  '/quotations/:quotationId/installation_team',
  validate(patchQuotationInstallationTeamSchema),
  patchQuotationInstallationTeam
);
router.get('/installation-teams', listInstallationTeams);
router.post('/installation-teams', validate(createInstallationTeamSchema), createInstallationTeam);
router.patch('/installation-teams/:teamId', validate(patchInstallationTeamSchema), patchInstallationTeam);
router.patch(
  '/installation-teams/:teamId/password',
  validate(patchInstallationTeamPasswordSchema),
  patchInstallationTeamPassword
);
router.patch(
  '/installation-teams/:teamId/reset-password',
  validate(patchInstallationTeamPasswordSchema),
  patchInstallationTeamPassword
);
router.delete('/installation-teams/:teamId', deleteInstallationTeam);
// Compatibility aliases used by some frontend builds.
router.get('/installation/team-logins', listInstallationTeams);
router.get('/installation-team-logins', listInstallationTeams);
router.post('/installation/team-logins', validate(createInstallationTeamSchema), createInstallationTeam);
router.post('/installation-team-logins', validate(createInstallationTeamSchema), createInstallationTeam);
router.patch('/installation/team-logins/:teamId', validate(patchInstallationTeamSchema), patchInstallationTeam);
router.patch('/installation-team-logins/:teamId', validate(patchInstallationTeamSchema), patchInstallationTeam);
router.patch(
  '/installation/team-logins/:teamId/password',
  validate(patchInstallationTeamPasswordSchema),
  patchInstallationTeamPassword
);
router.patch(
  '/installation-team-logins/:teamId/password',
  validate(patchInstallationTeamPasswordSchema),
  patchInstallationTeamPassword
);
router.patch(
  '/installation/team-logins/:teamId/reset-password',
  validate(patchInstallationTeamPasswordSchema),
  patchInstallationTeamPassword
);
router.patch(
  '/installation-team-logins/:teamId/reset-password',
  validate(patchInstallationTeamPasswordSchema),
  patchInstallationTeamPassword
);
router.delete('/installation/team-logins/:teamId', deleteInstallationTeam);
router.delete('/installation-team-logins/:teamId', deleteInstallationTeam);
router.get('/leads/uploads/:batchId', getHrLeadUploadBatchRows);
router.post(
  '/leads/uploads/:uploadId/assign-unassigned',
  validate(assignUnassignedLeadsSchema),
  assignHrUploadUnassigned
);

/**
 * @swagger
 * /api/admin/dealers:
 *   get:
 *     summary: Get all dealers (admin)
 *     description: Retrieve all dealers with complete registration information, statistics, and filtering options
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Items per page (max 100)
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *         description: Filter by active status (true/false)
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by name, email, mobile, username
 *     responses:
 *       200:
 *         description: Dealers retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     dealers:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Dealer'
 *                     pagination:
 *                       $ref: '#/components/schemas/Pagination'
 */
router.get('/dealers', getAllDealers);

/**
 * @swagger
 * /api/admin/dealers/{dealerId}:
 *   put:
 *     summary: Update dealer (admin)
 *     description: Update dealer information including activation status
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: dealerId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               email:
 *                 type: string
 *               mobile:
 *                 type: string
 *               gender:
 *                 type: string
 *                 enum: [Male, Female, Other]
 *               dateOfBirth:
 *                 type: string
 *                 format: date
 *               fatherName:
 *                 type: string
 *               fatherContact:
 *                 type: string
 *               governmentIdType:
 *                 type: string
 *               governmentIdNumber:
 *                 type: string
 *               address:
 *                 type: object
 *               isActive:
 *                 type: boolean
 *               emailVerified:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Dealer updated successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Dealer not found
 */
router.put('/dealers/:dealerId', validate(adminUpdateDealerSchema), updateDealer);

/**
 * @swagger
 * /api/admin/dealers/{dealerId}/activate:
 *   patch:
 *     summary: Activate dealer (admin)
 *     description: Convenience endpoint to activate/approve a pending dealer
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: dealerId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Dealer activated successfully
 *       404:
 *         description: Dealer not found
 */
router.patch('/dealers/:dealerId/activate', activateDealer);

/**
 * @swagger
 * /api/admin/statistics:
 *   get:
 *     summary: Get system statistics (admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get('/statistics', getSystemStatistics);
router.get('/calling-actions/summary', getAdminCallingActionsSummary);
router.get('/calling-actions', getAdminCallingActions);
router.get('/calling-queue/actions', getAdminCallingActions);
router.get('/leads/actions', getAdminCallingActions);

/**
 * @swagger
 * /api/admin/visitors:
 *   post:
 *     summary: Create visitor (admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.post('/visitors', validate(createVisitorSchema), createVisitor);

/**
 * @swagger
 * /api/admin/visitors:
 *   get:
 *     summary: Get all visitors (admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get('/visitors', getAllVisitors);

/**
 * @swagger
 * /api/admin/visitors/{visitorId}:
 *   get:
 *     summary: Get visitor by ID (admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get('/visitors/:visitorId', getVisitorById);

/**
 * @swagger
 * /api/admin/visitors/{visitorId}:
 *   put:
 *     summary: Update visitor (admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.put('/visitors/:visitorId', validate(updateVisitorSchema), updateVisitor);

/**
 * @swagger
 * /api/admin/visitors/{visitorId}/password:
 *   put:
 *     summary: Update visitor password (admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.put('/visitors/:visitorId/password', validate(updateVisitorPasswordSchema), updateVisitorPassword);

/**
 * @swagger
 * /api/admin/visitors/{visitorId}:
 *   delete:
 *     summary: Deactivate visitor (admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/visitors/:visitorId', deleteVisitor);

export default router;


