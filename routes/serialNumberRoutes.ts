import express, { Router } from 'express';
import { searchSerialNumber, deleteSerialNumber } from '../controllers/serialNumberController';
import { authenticate, authorizeProductManagement } from '../middleware/auth';

const router: Router = express.Router();

// All routes require authentication
router.use(authenticate);

router.get('/search', searchSerialNumber);
router.delete('/:id', authorizeProductManagement, deleteSerialNumber);

export default router;
