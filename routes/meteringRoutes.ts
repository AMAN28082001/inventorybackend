import express, { Router } from 'express';
import multer, { MulterError } from 'multer';
import { authenticate, authorizeMetering } from '../middleware/authQuotation';
import { validate } from '../middleware/validate';
import { getMeteringQueue, meteringStatusUpdate, saveMeteringDetails, saveMeteringMcoDocuments } from '../controllers/workflowController';
import { updateQuotationBankProcess } from '../controllers/adminController';
import { meteringDetailsSchema, meteringMcoDocumentsSchema, meteringStatusSchema } from '../validations/workflowValidations';
import { bankProcessSchema } from '../validations/adminValidations';
import {
  isAllowedStandardImageOrPdfUpload,
  standardImageOrPdfValidationMessage
} from '../utils/uploadMimeTypes';

const router: Router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 8 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedStandardImageOrPdfUpload(file)) {
      cb(null, true);
      return;
    }
    cb(new Error(standardImageOrPdfValidationMessage(file.fieldname)));
  }
});

const METERING_DETAILS_FILE_FIELDS: multer.Field[] = [
  { name: 'meterDocumentImage', maxCount: 1 },
  { name: 'meter_document_image', maxCount: 1 },
  { name: 'meterDocument', maxCount: 1 },
  { name: 'meter_document', maxCount: 1 },
  { name: 'meterDocumentFile', maxCount: 1 },
  { name: 'file', maxCount: 1 },
  { name: 'meterInstallationPhoto', maxCount: 1 },
  { name: 'meter_installation_photo', maxCount: 1 },
  { name: 'plantLivePhoto', maxCount: 1 },
  { name: 'plant_live_photo', maxCount: 1 }
];

router.use(authenticate);
router.use(authorizeMetering);

router.get('/quotations', getMeteringQueue);
router.patch('/quotations/:quotationId/status', validate(meteringStatusSchema), meteringStatusUpdate);
router.patch(
  '/quotations/:quotationId/bank-process',
  validate(bankProcessSchema),
  updateQuotationBankProcess
);
router.patch(
  '/quotations/:quotationId/payment-details',
  validate(bankProcessSchema),
  updateQuotationBankProcess
);
router.post(
  '/quotations/:quotationId/details',
  (req, res, next) => {
    upload.fields(METERING_DETAILS_FILE_FIELDS)(req, res, (err) => {
      if (!err) {
        next();
        return;
      }
      const e = err as MulterError;
      if (e.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          success: false,
          error: { code: 'VAL_001', message: 'Uploaded file exceeds max file size' }
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
