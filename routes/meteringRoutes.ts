import express, { Router } from 'express';
import multer, { MulterError } from 'multer';
import { authenticate, authorizeMetering } from '../middleware/authQuotation';
import { validate } from '../middleware/validate';
import { getMeteringQueue, meteringStatusUpdate, saveMeteringDetails, saveMeteringMcoDocuments } from '../controllers/workflowController';
import { meteringDetailsSchema, meteringMcoDocumentsSchema, meteringStatusSchema } from '../validations/workflowValidations';

const router: Router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 5 }
});

router.use(authenticate);
router.use(authorizeMetering);

router.get('/quotations', getMeteringQueue);
router.patch('/quotations/:quotationId/status', validate(meteringStatusSchema), meteringStatusUpdate);
router.post(
  '/quotations/:quotationId/details',
  (req, res, next) => {
    upload.fields([{ name: 'meterDocumentImage', maxCount: 1 }])(req, res, (err) => {
      if (!err) {
        next();
        return;
      }
      const e = err as MulterError;
      if (e.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          success: false,
          error: { code: 'VAL_001', message: 'meterDocumentImage exceeds max file size' }
        });
        return;
      }
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: e.message || 'Invalid multipart payload' }
      });
    });
  },
  validate(meteringDetailsSchema),
  saveMeteringDetails
);

router.post(
  '/quotations/:quotationId/mco-documents',
  (req, res, next) => {
    upload.fields([
      { name: 'workCompleteReportImage', maxCount: 1 },
      { name: 'meterInstalledPhoto', maxCount: 1 },
      { name: 'completeDcrReportImage', maxCount: 1 }
    ])(req, res, (err) => {
      if (!err) {
        next();
        return;
      }
      const e = err as MulterError;
      if (e.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'One or more MCO documents exceed max file size' }
        });
        return;
      }
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: e.message || 'Invalid multipart payload' }
      });
    });
  },
  validate(meteringMcoDocumentsSchema),
  saveMeteringMcoDocuments
);

router.post(
  '/quotations/:quotationId/documents',
  (req, res, next) => {
    upload.fields([
      { name: 'workCompleteReportImage', maxCount: 1 },
      { name: 'meterInstalledPhoto', maxCount: 1 },
      { name: 'completeDcrReportImage', maxCount: 1 }
    ])(req, res, (err) => {
      if (!err) {
        next();
        return;
      }
      const e = err as MulterError;
      if (e.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'One or more MCO documents exceed max file size' }
        });
        return;
      }
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: e.message || 'Invalid multipart payload' }
      });
    });
  },
  validate(meteringMcoDocumentsSchema),
  saveMeteringMcoDocuments
);

export default router;
