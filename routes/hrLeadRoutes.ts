import express, { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/authQuotation';
import { Request, Response, NextFunction } from 'express';
import {
  uploadCallingLeadsCsv,
  getHrDealersForAssignment,
  getHrDealerAssignmentStats,
  getHrCallingActions,
  getHrCallingActionsSummary,
  getHrLeadUploadBatches,
  getHrLeadUploadBatchRows,
  getHrLeadsSearchByMobile,
  assignHrUploadUnassigned
} from '../controllers/callingLeadController';
import { validate } from '../middleware/validate';
import {
  uploadCallingLeadsSchema,
  assignUnassignedLeadsSchema
} from '../validations/callingLeadValidations';

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
router.get('/calling-actions/summary', getHrCallingActionsSummary);
router.get('/calling-actions', getHrCallingActions);
// Alias used by some frontend builds (§J / §4.8)
router.get('/calling-queue/actions', getHrCallingActions);
/** Global calling-lead mobile search (SPA HR Uploaded Data search). */
router.get('/leads/search', getHrLeadsSearchByMobile);
router.get('/leads/uploads', getHrLeadUploadBatches);
router.get('/leads/uploads/:batchId', getHrLeadUploadBatchRows);
// §15-C — drain Unassigned → 0 for an existing batch (round-robin onto dealer pool)
router.post(
  '/leads/uploads/:uploadId/assign-unassigned',
  validate(assignUnassignedLeadsSchema),
  assignHrUploadUnassigned
);
// Alias routes used by different frontend builds
router.get('/calling-uploads/:batchId', getHrLeadUploadBatchRows);
router.get('/uploads/:batchId', getHrLeadUploadBatchRows);
router.post(
  '/uploads/:uploadId/assign-unassigned',
  validate(assignUnassignedLeadsSchema),
  assignHrUploadUnassigned
);
router.post(
  '/calling-uploads/:uploadId/assign-unassigned',
  validate(assignUnassignedLeadsSchema),
  assignHrUploadUnassigned
);
router.post('/leads/upload-csv', upload.fields([{ name: 'file', maxCount: 1 }, { name: 'csvFile', maxCount: 1 }]), validate(uploadCallingLeadsSchema), uploadCallingLeadsCsv);

export default router;
