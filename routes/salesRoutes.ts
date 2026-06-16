import express, { Router } from 'express';
import {
  getAllSales,
  getSaleById,
  getCustomerByPhone,
  createSale,
  updateSale,
  confirmB2BBill,
  approveSale,
  deleteSale,
  getSalesSummary
} from '../controllers/salesController';
import { authenticate, authorize } from '../middleware/auth';
import upload, { uploadToS3 } from '../middleware/upload';
import { validateWithJsonParse } from '../middleware/validateWithJsonParse';
import { validate } from '../middleware/validate';
import { createSaleSchema, updateSaleSchema } from '../validations/salesValidations';

const router: Router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * @swagger
 * /api/sales:
 *   get:
 *     summary: Get all sales (filtered by role)
 *     tags: [Sales]
 *     security:
 *       - bearerAuth: []
 *     description: >
 *       Results are filtered on the server based on the authenticated user's role:
 *       - Agents see only their own sales (created_by = current user).
 *       - Admins see their own sales and sales from agents they created.
 *       - Account and Super-Admin roles see all sales.
 *     responses:
 *       200:
 *         description: List of sales
 */
router.get('/', getAllSales);

/**
 * @swagger
 * /api/sales/summary:
 *   get:
 *     summary: Get sales summary (respecting role-based filters)
 *     tags: [Sales]
 *     security:
 *       - bearerAuth: []
 *     description: >
 *       Aggregated sales summary. The underlying data is filtered using the same role-based
 *       rules as GET /api/sales, so agents and admins only see summaries for sales they are
 *       allowed to access.
 *     responses:
 *       200:
 *         description: Sales summary
 */
router.get('/summary', getSalesSummary);
router.get('/customer-by-phone', getCustomerByPhone);

/**
 * @swagger
 * /api/sales/{id}:
 *   get:
 *     summary: Get sale by ID
 *     tags: [Sales]
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
 *         description: Sale details
 *       404:
 *         description: Sale not found
 */
router.get('/:id', getSaleById);

/**
 * @swagger
 * /api/sales:
 *   post:
 *     summary: Create a new sale
 *     tags: [Sales]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - customer_name
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [B2B, B2C]
 *               customer_name:
 *                 type: string
 *               items:
 *                 type: string
 *                 description: JSON string array of items
 *               subtotal:
 *                 type: number
 *               tax_amount:
 *                 type: number
 *               discount_amount:
 *                 type: number
 *               payment_status:
 *                 type: string
 *                 enum: [pending, completed]
 *               image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Sale created successfully
 *       400:
 *         description: Validation error
 */
router.post('/', authorize('agent', 'admin'), upload.single('image'), uploadToS3('sales'), validateWithJsonParse(createSaleSchema, ['items']), createSale);

// Update - creator, admin, or super-admin can update
router.put('/:id', upload.single('image'), uploadToS3('sales'), validate(updateSaleSchema), updateSale);

// Confirm B2B bill - only account role
router.post('/:id/confirm-bill', authorize('account', 'super-admin-manager', 'super-admin'), upload.single('bill_image'), uploadToS3('sales'), confirmB2BBill);

// Approve sale - only account role
router.post('/:id/approve', authorize('account', 'super-admin-manager', 'super-admin'), approveSale);

// Delete - creator or super-admin can delete
router.delete('/:id', deleteSale);

export default router;

