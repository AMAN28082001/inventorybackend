import express, { Router } from 'express';
import {
  getAllAdminInventory,
  getAdminInventoryById,
  getAdminInventoryByAdminId,
  getAdminProductSerialNumbers,
  upsertAdminInventory,
  updateAdminInventory,
  deleteAdminInventory
} from '../controllers/adminInventoryController';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { upsertAdminInventorySchema, updateAdminInventorySchema } from '../validations/adminInventoryValidations';

const router: Router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get routes - accessible by all authenticated users
router.get('/', getAllAdminInventory);
router.get('/admin/:adminId', getAdminInventoryByAdminId);
router.get('/admin/:adminId/products/:productId/serial-numbers', getAdminProductSerialNumbers);
router.get('/:id', getAdminInventoryById);

// Create/Update routes - super-admin manages
router.post('/', authorize('super-admin'), validate(upsertAdminInventorySchema), upsertAdminInventory);
router.put('/:id', authorize('super-admin'), validate(updateAdminInventorySchema), updateAdminInventory);
router.delete('/:id', authorize('super-admin'), deleteAdminInventory);

export default router;

