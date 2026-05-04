import express, { Router } from 'express';
import { registerDealer, getDealerProfile, updateDealerProfile, getDealerStatistics, getVisitors } from '../controllers/dealerController';
import { rescheduleVisit } from '../controllers/visitController';
import {
  getDealerCallingQueueCurrent,
  getDealerCallingQueueNext,
  updateDealerCallingQueueAction,
  getDealerScheduledQueue,
  getDealerDialledActions,
  getDealerConnectedActions,
  getDealerNotConnectedActions
} from '../controllers/callingLeadController';
import { authenticate, authorizeDealer } from '../middleware/authQuotation';
import { validate } from '../middleware/validate';
import { registerDealerSchema, updateDealerSchema } from '../validations/dealerValidations';
import { dealerLeadActionSchema } from '../validations/callingLeadValidations';
import { rescheduleVisitSchema } from '../validations/visitValidations';

const router: Router = express.Router();

/**
 * @swagger
 * /api/dealers/register:
 *   post:
 *     summary: Register new dealer (PUBLIC)
 *     description: Register a new dealer account. New dealers are registered with isActive=false and require admin approval.
 *     tags: [Dealers]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DealerRegisterRequest'
 *     responses:
 *       201:
 *         description: Dealer registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Dealer registered successfully. Please verify your email to activate your account.
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     username:
 *                       type: string
 *                     firstName:
 *                       type: string
 *                     lastName:
 *                       type: string
 *                     email:
 *                       type: string
 *                     mobile:
 *                       type: string
 *                     role:
 *                       type: string
 *                       example: dealer
 *                     isActive:
 *                       type: boolean
 *                       example: false
 *                     emailVerified:
 *                       type: boolean
 *                       example: false
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Validation error or duplicate username/email/mobile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               duplicateUsername:
 *                 value:
 *                   success: false
 *                   error:
 *                     code: VAL_001
 *                     message: Validation error
 *                     details:
 *                       - field: username
 *                         message: Username already exists
 *               duplicateEmail:
 *                 value:
 *                   success: false
 *                   error:
 *                     code: VAL_001
 *                     message: Validation error
 *                     details:
 *                       - field: email
 *                         message: Email already exists
 */
router.post('/register', validate(registerDealerSchema), registerDealer);

// All routes below require authentication
router.use(authenticate);
router.use(authorizeDealer);

/**
 * @swagger
 * /api/dealers/me:
 *   get:
 *     summary: Get dealer profile
 *     description: Retrieve the authenticated dealer's profile information
 *     tags: [Dealers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dealer profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Dealer'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/me', getDealerProfile);

/**
 * @swagger
 * /api/dealers/me:
 *   put:
 *     summary: Update dealer profile
 *     description: Update the authenticated dealer's profile information
 *     tags: [Dealers]
 *     security:
 *       - bearerAuth: []
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
 *                 format: email
 *               mobile:
 *                 type: string
 *                 pattern: '^\d{10}$'
 *               company:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Dealer'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 */
router.put('/me', validate(updateDealerSchema), updateDealerProfile);

/**
 * @swagger
 * /api/dealers/me/statistics:
 *   get:
 *     summary: Get dealer statistics
 *     description: Retrieve statistics for the authenticated dealer including quotations, customers, and revenue
 *     tags: [Dealers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for statistics (ISO date format)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for statistics (ISO date format)
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/DealerStatistics'
 *       401:
 *         description: Unauthorized
 */
router.get('/me/statistics', getDealerStatistics);

/**
 * @swagger
 * /api/dealers/visitors:
 *   get:
 *     summary: Get visitors list
 *     description: Retrieve list of active visitors for assigning to visits
 *     tags: [Dealers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by name, email, mobile, or employee ID
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *         description: Filter by active status (defaults to true if not specified)
 *     responses:
 *       200:
 *         description: Visitors retrieved successfully
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
 *                     visitors:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           username:
 *                             type: string
 *                           firstName:
 *                             type: string
 *                           lastName:
 *                             type: string
 *                           fullName:
 *                             type: string
 *                           email:
 *                             type: string
 *                           mobile:
 *                             type: string
 *                           employeeId:
 *                             type: string
 *                           isActive:
 *                             type: boolean
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *       401:
 *         description: Unauthorized
 */
router.get('/visitors', getVisitors);

router.get('/me/calling-queue/next', getDealerCallingQueueNext);
router.get('/me/calling-queue/current', getDealerCallingQueueCurrent);
router.get('/me/calling-queue/scheduled', getDealerScheduledQueue);
router.get('/me/calling-actions/dialled', getDealerDialledActions);
router.get('/me/calling-actions/connected', getDealerConnectedActions);
router.get('/me/calling-actions/not-connected', getDealerNotConnectedActions);
router.patch('/me/calling-queue/:leadId/action', validate(dealerLeadActionSchema), updateDealerCallingQueueAction);

/** Dealer dashboard: same behavior as `PATCH /api/visits/:visitId/reschedule` (frontend fallbacks). */
router.patch('/visits/:visitId/reschedule', validate(rescheduleVisitSchema), rescheduleVisit);
router.patch('/me/visits/:visitId/reschedule', validate(rescheduleVisitSchema), rescheduleVisit);

export default router;


