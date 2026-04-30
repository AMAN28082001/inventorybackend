import express, { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/authQuotation';
import { Request, Response, NextFunction } from 'express';
import {
  uploadCallingLeadsCsv,
  getHrDealersForAssignment,
  getHrDealerAssignmentStats,
  getHrCallingActions,
  getHrLeadUploadBatches,
  getHrLeadUploadBatchRows
} from '../controllers/callingLeadController';
import { validate } from '../middleware/validate';
import { uploadCallingLeadsSchema } from '../validations/callingLeadValidations';

const router: Router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const authorizeHrLeadAccess = (req: Request, res: Response, next: NextFunction): void => {
  const role = req.user?.role;
  const allowed = role === 'hr' || role === 'admin' || role === 'super-admin' || role === 'super-admin-manager';
  if (!allowed) {
    res.status(403).json({
      success: false,
      error: { code: 'AUTH_004', message: 'Insufficient permissions' }
    });
    return;
  }
  next();
};

router.use(authenticate);
router.use(authorizeHrLeadAccess);

router.get('/dealers', getHrDealersForAssignment);
router.get('/dealers/assignment-stats', getHrDealerAssignmentStats);
router.get('/calling-actions', getHrCallingActions);
router.get('/leads/uploads', getHrLeadUploadBatches);
router.get('/leads/uploads/:batchId', getHrLeadUploadBatchRows);
// Alias routes used by different frontend builds
router.get('/calling-uploads/:batchId', getHrLeadUploadBatchRows);
router.get('/uploads/:batchId', getHrLeadUploadBatchRows);
router.post('/leads/upload-csv', upload.fields([{ name: 'file', maxCount: 1 }, { name: 'csvFile', maxCount: 1 }]), validate(uploadCallingLeadsSchema), uploadCallingLeadsCsv);

export default router;
