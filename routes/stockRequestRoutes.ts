import express, { Router } from 'express';
import {
  getAllStockRequests,
  getStockRequestById,
  createStockRequest,
  dispatchStockRequest,
  confirmStockRequest,
  updateStockRequest,
  deleteStockRequest
} from '../controllers/stockRequestController';
import { authenticate, authorize } from '../middleware/auth';
import upload, { uploadToS3 } from '../middleware/upload';
import { validateWithJsonParse } from '../middleware/validateWithJsonParse';
import { logRequestBeforeValidation, logRequestAfterValidation } from '../middleware/requestLogger';
import { createStockRequestSchema, updateStockRequestSchema } from '../validations/stockRequestValidations';

const router: Router = express.Router();

// All routes require authentication
router.use(authenticate);

// Block agents from all stock request operations
router.use((req, res, next) => {
  if (req.user?.role === 'agent') {
    res.status(403).json({ error: 'Agents cannot access stock requests' });
    return;
  }
  next();
});

/**
 * @swagger
 * /api/stock-requests:
 *   get:
 *     summary: Get all stock requests (filtered by role)
 *     tags: [Stock Requests]
 *     security:
 *       - bearerAuth: []
 *     description: >
 *       Results are filtered on the server based on the authenticated user's role:
 *       - Agents see only their own requests (requested_by_id = current user).
 *       - Admins see requests from their agents, their own requests to super-admin or other admins,
 *         and incoming admin-to-admin transfers.
 *       - Super-admin sees requests coming to super-admin.
 *       - Account role can see all requests.
 *     responses:
 *       200:
 *         description: List of stock requests
 */
router.get('/', getAllStockRequests);

/**
 * @swagger
 * /api/stock-requests/{id}:
 *   get:
 *     summary: Get stock request by ID
 *     tags: [Stock Requests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Stock request details
 *       404:
 *         description: Stock request not found
 */
router.get('/:id', getStockRequestById);

/**
 * @swagger
 * /api/stock-requests:
 *   post:
 *     summary: Create a new stock request
 *     tags: [Stock Requests]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - requested_from
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     product_id:
 *                       type: string
 *                     product_name:
 *                       type: string
 *                     model:
 *                       type: string
 *                     quantity:
 *                       type: integer
 *               requested_from:
 *                 type: string
 *               notes:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [pending]
 *     responses:
 *       201:
 *         description: Stock request created successfully
 *       400:
 *         description: Validation error
 */
router.post('/', 
  authorize('admin', 'agent'), 
  logRequestBeforeValidation,
  validateWithJsonParse(createStockRequestSchema, ['items']),
  logRequestAfterValidation,
  createStockRequest
);

// Dispatch - super-admin and admins can dispatch
router.post(
  '/:id/dispatch',
  authorize('super-admin', 'super-admin-manager', 'admin'),
  upload.single('dispatch_image'),
  uploadToS3('stock-requests'),
  dispatchStockRequest
);

// Confirm - requester can confirm
router.post('/:id/confirm', upload.single('confirmation_image'), uploadToS3('stock-requests'), confirmStockRequest);

// Update - requester can update pending requests
router.put('/:id', validateWithJsonParse(updateStockRequestSchema, ['items']), updateStockRequest);

// Delete - requester or super-admin can delete pending requests
router.delete('/:id', deleteStockRequest);

export default router;

