import express, { Router } from 'express';
import multer from 'multer';
import { authenticate, authorizeBaldev } from '../middleware/authQuotation';
import { validate } from '../middleware/validate';
import { baldevDecisionSchema, baldevUploadMetaSchema } from '../validations/workflowValidations';
import { getBaldevQueue, baldevDecision, baldevUploadDocuments } from '../controllers/workflowController';

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

export default router;
