import express, { NextFunction, Request, Response, Router } from 'express';
import multer, { MulterError } from 'multer';
import { authenticate, authorizeInstaller } from '../middleware/authQuotation';
import { validate } from '../middleware/validate';
import { installerStatusSchema, installerUploadMetaSchema } from '../validations/workflowValidations';
import { getInstallerQueue, installerDecision, installerUploadDocuments } from '../controllers/workflowController';

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

router.use(authenticate);
router.use(authorizeInstaller);

router.get('/quotations', getInstallerQueue);
router.get('/queue', getInstallerQueue);
router.patch('/quotations/:quotationId/status', validate(installerStatusSchema), installerDecision);
router.patch('/quotations/:quotationId/decision', validate(installerStatusSchema), installerDecision);
router.post(
  '/quotations/:quotationId/documents',
  handleInstallerMultipart,
  validate(installerUploadMetaSchema),
  installerUploadDocuments
);

export default router;
