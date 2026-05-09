import express, { Router } from 'express';
import multer, { MulterError } from 'multer';
import { getAssignedVisits, getVisitorStatistics } from '../controllers/visitorController';
import { completeVisit } from '../controllers/visitController';
import { authenticate, authorizeVisitor } from '../middleware/authQuotation';
import { validate } from '../middleware/validate';
import { completeVisitSchema } from '../validations/visitValidations';
import { uploadToS3FromMemory } from '../middleware/upload';

const router: Router = express.Router();
const completeVisitUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 25
  }
});

const handleCompleteVisitMultipart = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
  completeVisitUpload.fields([
    { name: 'images', maxCount: 20 },
    { name: 'rowDiagramImage', maxCount: 1 },
    { name: 'meterImage', maxCount: 1 }
  ])(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    const e = err as MulterError;
    if (e.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'One or more files exceed the maximum upload size' }
      });
      return;
    }
    if (e.code === 'LIMIT_FILE_COUNT' || e.code === 'LIMIT_UNEXPECTED_FILE') {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Unexpected or too many file fields',
          details: [{ field: e.field || 'files', message: e.message }]
        }
      });
      return;
    }
    next(err as any);
  });
};

// All routes require visitor authentication
router.use(authenticate);
router.use(authorizeVisitor);

/**
 * @swagger
 * /api/visitors/me/visits:
 *   get:
 *     summary: Get assigned visits (visitor)
 *     tags: [Visitors]
 *     security:
 *       - bearerAuth: []
 */
router.get('/me/visits', getAssignedVisits);

/**
 * @swagger
 * /api/visitors/me/statistics:
 *   get:
 *     summary: Get visitor statistics
 *     tags: [Visitors]
 *     security:
 *       - bearerAuth: []
 */
router.get('/me/statistics', getVisitorStatistics);

// Visitor-friendly complete-visit aliases (same controller as /api/visits/:visitId/complete)
router.patch(
  '/me/visits/:visitId/complete',
  handleCompleteVisitMultipart,
  uploadToS3FromMemory('visits'),
  validate(completeVisitSchema),
  completeVisit
);
router.patch(
  '/visits/:visitId/complete',
  handleCompleteVisitMultipart,
  uploadToS3FromMemory('visits'),
  validate(completeVisitSchema),
  completeVisit
);

export default router;

