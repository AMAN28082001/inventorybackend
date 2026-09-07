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
  assignHrUploadUnassigned,
  updateHrUploadDealerPool
} from '../controllers/callingLeadController';
import {
  listHrSheetSources,
  discoverHrSheetTabs,
  patchHrSheetSource,
  postHrSheetSourceSync,
  postHrSheetSourcesSyncAll,
  getHrSheetSourceLeads
} from '../controllers/hrSheetSourceController';
import { validate } from '../middleware/validate';
import {
  uploadCallingLeadsSchema,
  assignUnassignedLeadsSchema,
  updateUploadDealerPoolSchema
} from '../validations/callingLeadValidations';
import {
  discoverHrSheetTabsSchema,
  patchHrSheetSourceSchema,
  hrSheetSourceLeadsQuerySchema
} from '../validations/hrSheetSourceValidations';
import { canAccessSection, hasAdminPanelAccess } from '../utils/userAccess';

const router: Router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const authorizeHrLeadAccess = (req: Request, res: Response, next: NextFunction): void => {
  const role = String(req.user?.role || req.dealer?.role || '').toLowerCase();
  const allowed =
    role === 'hr' ||
    role === 'human_resources' ||
    role === 'admin' ||
    role === 'super-admin' ||
    role === 'super-admin-manager' ||
    canAccessSection(
      {
        role: req.user?.role ?? req.dealer?.role,
        access: (req.user as any)?.access ?? req.dealer?.access,
        username: req.user?.username ?? req.dealer?.username
      },
      'hr'
    ) ||
    hasAdminPanelAccess(req);
  if (!allowed) {
    res.status(403).json({
      success: false,
      error: { code: 'AUTH_004', message: 'Insufficient permissions' }
    });
    return;
  }
  next();
};

/** HR JWT or `x-cron-secret` matching `CRON_SECRET` (sheet auto-sync). */
const authenticateHrOrCron = (req: Request, res: Response, next: NextFunction): void => {
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const headerSecret = String(req.headers['x-cron-secret'] || '').trim();
  if (cronSecret && headerSecret && headerSecret === cronSecret) {
    (req as Request & { isCronSheetSync?: boolean }).isCronSheetSync = true;
    next();
    return;
  }
  authenticate(req, res, () => authorizeHrLeadAccess(req, res, next));
};

/**
 * P0 auto-sync — must be registered BEFORE authenticate + `/:id` routes
 * so cron can call with x-cron-secret only (no JWT).
 */
router.post('/sheet-sources/sync-all', authenticateHrOrCron, postHrSheetSourcesSyncAll);

router.use(authenticate);
router.use(authorizeHrLeadAccess);

router.get('/dealers', getHrDealersForAssignment);
router.get('/assignable-dealers', getHrDealersForAssignment);
router.get('/dealer-pool', getHrDealersForAssignment);
router.get('/assignment/dealers', getHrDealersForAssignment);
router.get('/dealers/assignment-stats', getHrDealerAssignmentStats);
router.get('/calling-actions/summary', getHrCallingActionsSummary);
router.get('/calling-actions', getHrCallingActions);
// Alias used by some frontend builds (§J / §4.8)
router.get('/calling-queue/actions', getHrCallingActions);
/** Global calling-lead mobile search (SPA HR Uploaded Data search). */
router.get('/leads/search', getHrLeadsSearchByMobile);
router.get('/leads/uploads', getHrLeadUploadBatches);
router.get('/leads/uploads/:batchId', getHrLeadUploadBatchRows);
/** §15-D — Manage dealers: replace (or add) upload dealer pool */
router.patch(
  '/leads/uploads/:uploadId/dealers',
  validate(updateUploadDealerPoolSchema),
  updateHrUploadDealerPool
);
router.patch(
  '/leads/uploads/:uploadId',
  validate(updateUploadDealerPoolSchema),
  updateHrUploadDealerPool
);
router.put(
  '/uploads/:uploadId/dealers',
  validate(updateUploadDealerPoolSchema),
  updateHrUploadDealerPool
);
router.patch(
  '/calling-uploads/:uploadId/dealers',
  validate(updateUploadDealerPoolSchema),
  updateHrUploadDealerPool
);
router.post(
  '/leads/uploads/:uploadId/add-dealers',
  validate(updateUploadDealerPoolSchema),
  updateHrUploadDealerPool
);
router.post(
  '/calling-uploads/:uploadId/add-dealers',
  validate(updateUploadDealerPoolSchema),
  updateHrUploadDealerPool
);
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

/** Google Sheets → Social Media leads (§42 / BACKEND_GOOGLE_SHEETS_SOCIAL_LEADS.ts) */
router.get('/sheet-sources', listHrSheetSources);
router.post('/sheet-sources/discover', validate(discoverHrSheetTabsSchema), discoverHrSheetTabs);
// sync-all is registered above authenticate (cron + HR)
router.patch('/sheet-sources/:id', validate(patchHrSheetSourceSchema), patchHrSheetSource);
router.post('/sheet-sources/:id/sync', postHrSheetSourceSync);
router.get('/sheet-sources/:id/leads', validate(hrSheetSourceLeadsQuerySchema), getHrSheetSourceLeads);

export default router;
