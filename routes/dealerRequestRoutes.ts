import express, { Router } from 'express';
import {
  createDealerRequest,
  getDealerRequests,
  getDealerRequestById,
  updateDealerRequest,
  deleteDealerRequest,
  setDefaultDealerAssignment,
  getDefaultDealerAssignment
} from '../controllers/dealerRequestController';
import { authenticate, authorizeAdmin, authorizeDealerAdminOrVisitor } from '../middleware/authQuotation';
import { validate } from '../middleware/validate';
import {
  createDealerRequestSchema,
  updateDealerRequestSchema,
  setDefaultDealerSchema
} from '../validations/dealerRequestValidations';

const router: Router = express.Router();

// Public request intake (no auth)
router.post('/', validate(createDealerRequestSchema), createDealerRequest);

// Authenticated APIs
router.use(authenticate);

// Admin default auto-assignment config
router.get('/config/default-dealer', authorizeAdmin, getDefaultDealerAssignment);
router.put('/config/default-dealer', authorizeAdmin, validate(setDefaultDealerSchema), setDefaultDealerAssignment);

router.get('/', authorizeDealerAdminOrVisitor, getDealerRequests);
router.get('/:requestId', authorizeDealerAdminOrVisitor, getDealerRequestById);
router.patch('/:requestId', authorizeDealerAdminOrVisitor, validate(updateDealerRequestSchema), updateDealerRequest);
router.delete('/:requestId', authorizeAdmin, deleteDealerRequest);

export default router;
