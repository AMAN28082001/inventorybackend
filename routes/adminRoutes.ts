import express, { Router } from 'express';
import {
  getAllQuotations,
  getAdminQuotationById,
  updateQuotationStatus,
  updateQuotationInstallationStatus,
  updateQuotationFileLogin,
  getAllDealers,
  updateDealer,
  activateDealer,
  getSystemStatistics
} from '../controllers/adminController';
import {
  createVisitor,
  getAllVisitors,
  getVisitorById,
  updateVisitor,
  updateVisitorPassword,
  deleteVisitor
} from '../controllers/adminVisitorController';
import { getAdminCallingActions } from '../controllers/callingLeadController';
import { authenticate, authorizeAdmin } from '../middleware/authQuotation';
import { validate } from '../middleware/validate';
import {
  updateStatusSchema,
  updateInstallationStatusSchema,
  fileLoginSchema,
  createVisitorSchema,
  updateVisitorSchema,
  updateVisitorPasswordSchema
} from '../validations/adminValidations';
import { adminUpdateDealerSchema } from '../validations/dealerValidations';

const router: Router = express.Router();

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

// All routes below require admin authorization
router.use(authorizeAdmin);

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
router.patch('/quotations/:quotationId/installation-status', validate(updateInstallationStatusSchema), updateQuotationInstallationStatus);
router.patch('/quotations/:quotationId/workflow-status', validate(updateInstallationStatusSchema), updateQuotationInstallationStatus);
router.patch('/quotations/:quotationId/file-login', validate(fileLoginSchema), updateQuotationFileLogin);

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
router.get('/calling-actions', getAdminCallingActions);

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


