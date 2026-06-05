import express, { Router } from 'express';
import {
  getAllInventoryTransactions,
  getInventoryTransactionById,
  createInventoryTransaction
} from '../controllers/inventoryTransactionController';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createInventoryTransactionSchema } from '../validations/inventoryTransactionValidations';

const router: Router = express.Router();

// All routes require authentication
router.use(authenticate);

// Read routes aligned with product-table access roles.
router.get('/', authorize('super-admin', 'super-admin-manager', 'admin', 'account', 'agent'), getAllInventoryTransactions);
router.get('/:id', authorize('super-admin', 'super-admin-manager', 'admin', 'account', 'agent'), getInventoryTransactionById);

// Create - super-admin and admin can create manual transactions
router.post('/', authorize('super-admin', 'admin'), validate(createInventoryTransactionSchema), createInventoryTransaction);

export default router;

