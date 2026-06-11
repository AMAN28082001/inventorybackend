import express, { Router } from 'express';
import {
  getAllProducts,
  getProductById,
  getProductSerialNumbers,
  createProduct,
  updateProduct,
  deleteProduct,
  getInventoryLevels
} from '../controllers/productController';
import { authenticate, authorizeProductManagement } from '../middleware/auth';
import { conditionalProductMultipartUpload } from '../middleware/upload';
import { validate } from '../middleware/validate';
import { createProductSchema, updateProductSchema } from '../validations/productValidations';

const router: Router = express.Router();

/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: Get all products
 *     tags: [Products]
 *     responses:
 *       200:
 *         description: List of products
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Product'
 */
router.get('/', getAllProducts);

/**
 * @swagger
 * /api/products/inventory/levels:
 *   get:
 *     summary: Get inventory levels
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Inventory levels
 */
router.get('/inventory/levels', authenticate, getInventoryLevels);

/**
 * @swagger
 * /api/products/{id}/serial-numbers:
 *   get:
 *     summary: List serial numbers for a product
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:id/serial-numbers', authenticate, getProductSerialNumbers);

/**
 * @swagger
 * /api/products/{id}:
 *   get:
 *     summary: Get product by ID
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Product details
 *       404:
 *         description: Product not found
 */
router.get('/:id', getProductById);

// Protected mutation routes
router.use(authenticate);

/**
 * @swagger
 * /api/products:
 *   post:
 *     summary: Create a new product
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - model
 *               - category
 *             properties:
 *               name:
 *                 type: string
 *               model:
 *                 type: string
 *               wattage:
 *                 type: string
 *               category:
 *                 type: string
 *               quantity:
 *                 type: integer
 *               unit_price:
 *                 type: number
 *               image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Product created successfully
 *       400:
 *         description: Validation error
 */
router.post(
  '/',
  authorizeProductManagement,
  conditionalProductMultipartUpload('create'),
  validate(createProductSchema),
  createProduct
);

/**
 * @swagger
 * /api/products/{id}:
 *   put:
 *     summary: Update product
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               model:
 *                 type: string
 *               wattage:
 *                 type: string
 *               category:
 *                 type: string
 *               quantity:
 *                 type: integer
 *               unit_price:
 *                 type: number
 *               image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Product updated successfully
 *       404:
 *         description: Product not found
 */
router.put(
  '/:id',
  authorizeProductManagement,
  conditionalProductMultipartUpload('update'),
  validate(updateProductSchema),
  updateProduct
);

/**
 * @swagger
 * /api/products/{id}:
 *   delete:
 *     summary: Delete product
 *     tags: [Products]
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
 *         description: Product deleted successfully
 *       404:
 *         description: Product not found
 */
router.delete('/:id', authorizeProductManagement, deleteProduct);

export default router;

