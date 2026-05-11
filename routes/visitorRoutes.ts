import express, { Router } from 'express';
import multer, { MulterError } from 'multer';
import { getAssignedVisits, getVisitorStatistics } from '../controllers/visitorController';
import { completeVisit, uploadVisitMedia } from '../controllers/visitController';
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
  },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
    if (allowed.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error(`${file.fieldname} must be jpeg/jpg/png/webp`));
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

const handleSingleVisitUploadMultipart = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void => {
  completeVisitUpload.single('file')(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    const genericError = err as Error;
    if (genericError?.message?.includes('must be jpeg/jpg/png/webp')) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: genericError.message
        }
      });
      return;
    }
    const e = err as MulterError;
    if (e.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Uploaded file exceeds the maximum upload size' }
      });
      return;
    }
    if (e.code === 'LIMIT_UNEXPECTED_FILE') {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Expected a single file field named "file"',
          details: [{ field: e.field || 'file', message: e.message }]
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

router.post('/visits/:visitId/upload', handleSingleVisitUploadMultipart, uploadVisitMedia);
router.post('/me/visits/:visitId/upload', handleSingleVisitUploadMultipart, uploadVisitMedia);

export default router;

