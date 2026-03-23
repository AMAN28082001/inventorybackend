import express, { Router } from 'express';
import multer from 'multer';
import { authenticate, authorizeInstaller } from '../middleware/authQuotation';
import { validate } from '../middleware/validate';
import { installerStatusSchema, installerUploadMetaSchema } from '../validations/workflowValidations';
import { getInstallerQueue, installerDecision, installerUploadDocuments } from '../controllers/workflowController';

const router: Router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

router.use(authenticate);
router.use(authorizeInstaller);

router.get('/quotations', getInstallerQueue);
router.patch('/quotations/:quotationId/status', validate(installerStatusSchema), installerDecision);
// Backward compatible alias
router.patch('/quotations/:quotationId/decision', validate(installerStatusSchema), installerDecision);
router.post('/quotations/:quotationId/documents', upload.any(), validate(installerUploadMetaSchema), installerUploadDocuments);

export default router;
