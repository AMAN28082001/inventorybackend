import express, { Router } from 'express';
import {
  createVisit,
  getAllVisits,
  approveVisit,
  completeVisit,
  markVisitIncomplete,
  rescheduleVisit,
  rejectVisit,
  deleteVisit
} from '../controllers/visitController';
import { authenticate, authorizeDealer, authorizeVisitor } from '../middleware/authQuotation';
import { validate } from '../middleware/validate';
import { createVisitSchema, completeVisitSchema, incompleteVisitSchema, rescheduleVisitSchema, rejectVisitSchema } from '../validations/visitValidations';
import upload, { uploadToS3 } from '../middleware/upload';

const router: Router = express.Router();

/**
 * @swagger
 * /api/visits:
 *   post:
 *     summary: Create visit
 *     description: Create a new visit for a quotation (Dealer only)
 *     tags: [Visits]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - quotationId
 *               - visitDate
 *               - visitTime
 *               - location
 *             properties:
 *               quotationId:
 *                 type: string
 *               visitDate:
 *                 type: string
 *                 format: date
 *               visitTime:
 *                 type: string
 *                 format: time
 *               location:
 *                 type: string
 *               locationLink:
 *                 type: string
 *                 format: uri
 *               notes:
 *                 type: string
 *               visitors:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     visitorId:
 *                       type: string
 *     responses:
 *       201:
 *         description: Visit created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Visit'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post('/', authenticate, authorizeDealer, validate(createVisitSchema), createVisit);

/**
 * @swagger
 * /api/visits:
 *   get:
 *     summary: Get all visits (visit schedule)
 *     description: Retrieve all visits for the authenticated dealer with full visitor details
 *     tags: [Visits]
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
 *           maximum: 100
 *         description: Items per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, completed, incomplete, rejected, rescheduled]
 *         description: Filter by visit status
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter visits from this date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter visits until this date
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by customer name, location, or quotation ID
 *     responses:
 *       200:
 *         description: Visits retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     visits:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           quotation:
 *                             type: object
 *                           customer:
 *                             type: object
 *                           visitDate:
 *                             type: string
 *                             format: date
 *                           visitTime:
 *                             type: string
 *                           location:
 *                             type: string
 *                           status:
 *                             type: string
 *                           visitors:
 *                             type: array
 *                             items:
 *                               type: object
 *                               properties:
 *                                 visitorId:
 *                                   type: string
 *                                 username:
 *                                   type: string
 *                                 firstName:
 *                                   type: string
 *                                 lastName:
 *                                   type: string
 *                                 fullName:
 *                                   type: string
 *                                 email:
 *                                   type: string
 *                                 mobile:
 *                                   type: string
 *                                 employeeId:
 *                                   type: string
 *                                 isActive:
 *                                   type: boolean
 *                     pagination:
 *                       $ref: '#/components/schemas/Pagination'
 *       401:
 *         description: Unauthorized
 */
router.get('/', authenticate, authorizeDealer, getAllVisits);

/**
 * @swagger
 * /api/quotations/{quotationId}/visits:
 *   get:
 *     summary: Get visits for quotation (dealer)
 *     tags: [Visits]
 *     security:
 *       - bearerAuth: []
 */
// Note: This route should be added to quotationRoutes.ts instead
// router.get('/quotations/:quotationId/visits', authenticate, authorizeDealer, getVisitsForQuotation);

/**
 * @swagger
 * /api/visits/{visitId}/approve:
 *   patch:
 *     summary: Approve visit (visitor)
 *     tags: [Visits]
 *     security:
 *       - bearerAuth: []
 */
router.patch('/:visitId/approve', authenticate, authorizeVisitor, approveVisit);

/**
 * @swagger
 * /api/visits/{visitId}/complete:
 *   patch:
 *     summary: Complete visit
 *     description: Mark a visit as completed with measurements and images (Visitor only)
 *     tags: [Visits]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: visitId
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
 *               length:
 *                 type: number
 *               width:
 *                 type: number
 *               height:
 *                 type: number
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: base64
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Visit completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Visit'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.patch(
  '/:visitId/complete',
  authenticate,
  authorizeVisitor,
  upload.fields([
    { name: 'images', maxCount: 20 },
    { name: 'rowDiagramImage', maxCount: 1 }
  ]),
  uploadToS3('visits'),
  validate(completeVisitSchema),
  completeVisit
);

/**
 * @swagger
 * /api/visits/{visitId}/incomplete:
 *   patch:
 *     summary: Mark visit as incomplete (visitor)
 *     tags: [Visits]
 *     security:
 *       - bearerAuth: []
 */
router.patch('/:visitId/incomplete', authenticate, authorizeVisitor, validate(incompleteVisitSchema), markVisitIncomplete);

/**
 * @swagger
 * /api/visits/{visitId}/reschedule:
 *   patch:
 *     summary: Reschedule visit (visitor)
 *     tags: [Visits]
 *     security:
 *       - bearerAuth: []
 */
router.patch('/:visitId/reschedule', authenticate, authorizeVisitor, validate(rescheduleVisitSchema), rescheduleVisit);

/**
 * @swagger
 * /api/visits/{visitId}/reject:
 *   patch:
 *     summary: Reject visit (visitor)
 *     tags: [Visits]
 *     security:
 *       - bearerAuth: []
 */
router.patch('/:visitId/reject', authenticate, authorizeVisitor, validate(rejectVisitSchema), rejectVisit);

/**
 * @swagger
 * /api/visits/{visitId}:
 *   delete:
 *     summary: Delete visit (dealer)
 *     tags: [Visits]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/:visitId', authenticate, authorizeDealer, deleteVisit);

export default router;


