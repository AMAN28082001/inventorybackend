import express, { Router } from 'express';
import multer from 'multer';
import { authenticate, authorizeBaldev } from '../middleware/authQuotation';
import { validate } from '../middleware/validate';
import { baldevDecisionSchema, baldevUploadMetaSchema } from '../validations/workflowValidations';
import { getBaldevQueue, baldevDecision, baldevUploadDocuments } from '../controllers/workflowController';
import { saveFinalConfirmationDocuments, uploadQuotationDocument } from '../controllers/quotationController';
import {
  handleFinalConfirmationDocumentsMultipart,
  handleSingleQuotationDocumentUpload
} from './quotationRoutes';

const router: Router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

router.use(authenticate);
router.use(authorizeBaldev);

router.get('/quotations', getBaldevQueue);
router.patch('/quotations/:quotationId/decision', validate(baldevDecisionSchema), baldevDecision);
router.post('/quotations/:quotationId/documents', upload.array('files', 10), validate(baldevUploadMetaSchema), baldevUploadDocuments);
router.post(
  '/quotations/:quotationId/final-confirmation-documents',
  handleFinalConfirmationDocumentsMultipart,
  saveFinalConfirmationDocuments
);
router.post(
  '/quotations/:quotationId/final-confirmation-documents/upload',
  handleSingleQuotationDocumentUpload,
  uploadQuotationDocument
);

export default router;
