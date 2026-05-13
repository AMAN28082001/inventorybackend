import express, { NextFunction, Request, Response, Router } from 'express';
import multer, { MulterError } from 'multer';
import { authenticate, authorizeInstaller, authorizeInstallerOrAdmin } from '../middleware/authQuotation';
import { validate } from '../middleware/validate';
import { installerStatusSchema, installerUploadMetaSchema } from '../validations/workflowValidations';
import { getInstallerQueue, installerDecision, installerUploadDocuments, uploadInstallerDocument } from '../controllers/workflowController';

const router: Router = express.Router();

const INSTALLER_UPLOAD_FIELDS: multer.Field[] = [
  { name: 'installerCompletionImages', maxCount: 30 },
  { name: 'files', maxCount: 30 },
  { name: 'homeFrontPhoto', maxCount: 8 },
  { name: 'homeWithPersonPhoto', maxCount: 8 },
  { name: 'inverterWithCustomerPhoto', maxCount: 8 },
  { name: 'plantWithCustomerPhoto', maxCount: 8 },
  { name: 'inverterSerialNumberPhoto', maxCount: 8 },
  { name: 'panelSerialNumberPhoto', maxCount: 8 },
  { name: 'geoTagPlantPhoto', maxCount: 8 },
  { name: 'otherImages', maxCount: 20 },
  { name: 'piUpload', maxCount: 1 },
  { name: 'installerPo', maxCount: 3 }
];

const installerMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 80 }
});

const handleInstallerMultipart = (req: Request, res: Response, next: NextFunction): void => {
  installerMulter.fields(INSTALLER_UPLOAD_FIELDS)(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    const e = err as MulterError;
    if (e.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        success: false,
        error: { code: 'VAL_001', message: 'One or more files exceed the maximum upload size' }
      });
      return;
    }
    if (e.code === 'LIMIT_FILE_COUNT' || e.code === 'LIMIT_UNEXPECTED_FILE') {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Unexpected or too many file fields',
          details: [{ field: e.field || 'files', message: e.message }]
        }
      });
      return;
    }
    next(err);
  });
};

const handleSingleInstallerUploadMultipart = (req: Request, res: Response, next: NextFunction): void => {
  installerMulter.single('file')(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    const e = err as MulterError;
    if (e.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        success: false,
        error: { code: 'VAL_001', message: 'Uploaded file exceeds the maximum upload size' }
      });
      return;
    }
    if (e.code === 'LIMIT_UNEXPECTED_FILE') {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Expected a single file field named "file"',
          details: [{ field: e.field || 'file', message: e.message }]
        }
      });
      return;
    }
    next(err);
  });
};

router.use(authenticate);

router.get('/quotations', authorizeInstallerOrAdmin, getInstallerQueue);
router.get('/queue', authorizeInstallerOrAdmin, getInstallerQueue);

// Installer / field-team only (not quotation admin): workflow state transitions
router.patch('/quotations/:quotationId/status', authorizeInstaller, validate(installerStatusSchema), installerDecision);
router.patch('/quotations/:quotationId/decision', authorizeInstaller, validate(installerStatusSchema), installerDecision);

// Bulk + single completion uploads: admins use same handlers as installers (§6.4.C)
router.post(
  '/quotations/:quotationId/documents/upload',
  authorizeInstallerOrAdmin,
  handleSingleInstallerUploadMultipart,
  uploadInstallerDocument
);
router.post(
  '/quotations/:quotationId/upload',
  authorizeInstallerOrAdmin,
  handleSingleInstallerUploadMultipart,
  uploadInstallerDocument
);
router.post(
  '/quotations/:quotationId/documents',
  authorizeInstallerOrAdmin,
  handleInstallerMultipart,
  validate(installerUploadMetaSchema),
  installerUploadDocuments
);

/** Re-used by `quotationRoutes` for `/api/quotations/:id/installer-documents` fallbacks. */
export { handleInstallerMultipart, handleSingleInstallerUploadMultipart };

export default router;
