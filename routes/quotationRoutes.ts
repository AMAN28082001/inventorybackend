import express, { Router } from 'express';
import multer, { MulterError } from 'multer';
import {
  isAllowedStandardImageOrPdfUpload,
  isAllowedStandardImageUpload,
  isAllowedPdfUpload,
  pdfOnlyValidationMessage,
  standardImageOrPdfValidationMessage,
  standardImageValidationMessage
} from '../utils/uploadMimeTypes';
import {
  createQuotation,
  getQuotations,
  getQuotationCustomerByPhone,
  getQuotationById,
  updateQuotationDiscount,
  updateQuotationProducts,
  updateQuotationPricing,
  updateQuotationPaymentDetails,
  submitQuotationFinalSettlement,
  revertQuotationFinalSettlement,
  updateQuotationInstallationRelease,
  updateQuotationInstallationScheduledAt,
  downloadQuotationsExcel,
  downloadQuotationPDF,
  downloadQuotationDocumentsZip,
  getQuotationDocumentViewUrl,
  getProductCatalog,
  saveQuotationDocuments,
  saveFinalConfirmationDocuments,
  uploadQuotationDocument
} from '../controllers/quotationController';
import {
  FINAL_CONFIRMATION_DOCUMENT_FIELDS,
  isFinalConfirmationDocumentField
} from '../utils/finalConfirmationDocuments';
import { patchQuotationInstallationTeam } from '../controllers/installationTeamController';
import {
  getWorkflowHistory,
  meteringStatusUpdate,
  saveMeteringDetails,
  saveMeteringMcoDocuments,
  installerUploadDocuments,
  uploadInstallerDocument
} from '../controllers/workflowController';
import { getVisitsForQuotation, rescheduleVisit } from '../controllers/visitController';
import { getPricingTables } from '../controllers/configController';
import {
  authenticate,
  authorizeDealer,
  authorizeDealerAdminOrVisitor,
  authenticateInventoryOrQuotation,
  authorizeQuotationCustomerByPhone,
  authorizeDealerOrAccountManager,
  authorizeFinalConfirmationUploader,
  authorizeQuotationDocumentsEditor,
  authorizeInstallerOrAdmin,
  authorizeMeteringOrAdmin,
  authorizeAdmin,
  rejectAccountManager
} from '../middleware/authQuotation';
import { validate } from '../middleware/validate';
import { logRequestBeforeValidation, logRequestAfterValidation } from '../middleware/requestLogger';
import { createQuotationSchema, updateDiscountSchema, updateProductsSchema, updatePricingSchema, updatePaymentDetailsSchema, updatePaymentModeSchema, updateInstallationReleaseSchema, updateInstallationScheduledAtSchema, finalSettlementSchema, revertFinalSettlementSchema } from '../validations/quotationValidations';
import { patchQuotationInstallationTeamSchema, bankProcessSchema } from '../validations/adminValidations';
import {
  meteringDetailsSchema,
  meteringMcoDocumentsSchema,
  meteringStatusSchema,
  installerUploadMetaSchema
} from '../validations/workflowValidations';
import { handleInstallerMultipart, handleSingleInstallerUploadMultipart } from './installerRoutes';
import { rescheduleVisitSchema } from '../validations/visitValidations';
import { updateQuotationBankProcess } from '../controllers/adminController';

const router: Router = express.Router();
const MAX_PDF_UPLOAD_BYTES = 30 * 1024 * 1024; // 30 MB

const documentsUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const imageOnlyFields = new Set([
      'aadharFront',
      'aadharBack',
      'panImage',
      'bankPassbookImage',
      'compliantAadharFront',
      'compliantAadharBack',
      'compliantPanImage',
      'compliantBankPassbookImage',
      'geotagRoofPhoto',
      'customerWithHousePhoto'
    ]);
    const imageOrPdfFields = new Set([
      'customerFinalBillFile',
      'panelWarrantyFile',
      'inverterWarrantyFile',
      'workCompletionWarrantyFile'
    ]);
    const pdfOnlyFields = new Set(['propertyDocumentPdf', 'electricityBillImage']);

    if (imageOnlyFields.has(file.fieldname)) {
      if (isAllowedStandardImageUpload(file)) {
        cb(null, true);
        return;
      }
      cb(new Error(standardImageValidationMessage(file.fieldname)));
      return;
    }

    if (imageOrPdfFields.has(file.fieldname)) {
      if (isAllowedStandardImageOrPdfUpload(file)) {
        cb(null, true);
        return;
      }
      cb(new Error(standardImageOrPdfValidationMessage(file.fieldname)));
      return;
    }

    if (pdfOnlyFields.has(file.fieldname)) {
      if (isAllowedPdfUpload(file)) {
        cb(null, true);
        return;
      }
      cb(new Error(pdfOnlyValidationMessage(file.fieldname)));
      return;
    }

    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      cb(null, true);
      return;
    }
    cb(new Error('Only image or PDF uploads are allowed'));
  },
  limits: {
    fileSize: MAX_PDF_UPLOAD_BYTES,
    files: 25
  }
});

const DOCUMENT_UPLOAD_FIELDS: multer.Field[] = [
  { name: 'aadharFront', maxCount: 1 },
  { name: 'aadharBack', maxCount: 1 },
  { name: 'panImage', maxCount: 1 },
  { name: 'electricityBillImage', maxCount: 1 },
  { name: 'bankPassbookImage', maxCount: 1 },
  { name: 'geotagRoofPhoto', maxCount: 1 },
  { name: 'customerWithHousePhoto', maxCount: 1 },
  { name: 'propertyDocumentPdf', maxCount: 1 },
  { name: 'compliantAadharFront', maxCount: 1 },
  { name: 'compliantAadharBack', maxCount: 1 },
  { name: 'compliantPanImage', maxCount: 1 },
  { name: 'compliantBankPassbookImage', maxCount: 1 },
  { name: 'customerFinalBillFile', maxCount: 1 },
  { name: 'panelWarrantyFile', maxCount: 1 },
  { name: 'inverterWarrantyFile', maxCount: 1 },
  { name: 'workCompletionWarrantyFile', maxCount: 1 }
];

const FINAL_CONFIRMATION_UPLOAD_FIELDS: multer.Field[] = FINAL_CONFIRMATION_DOCUMENT_FIELDS.map(
  (name) => ({ name, maxCount: 1 })
);

export const handleFinalConfirmationDocumentsMultipart = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void => {
  documentsUpload.fields(FINAL_CONFIRMATION_UPLOAD_FIELDS)(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    const e = err as MulterError;
    if (e.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'One or more files exceed the 30 MB maximum upload size'
        }
      });
      return;
    }
    if (e.code === 'LIMIT_UNEXPECTED_FILE' || e.code === 'LIMIT_FILE_COUNT') {
      const field = e.field || 'files';
      const message = isFinalConfirmationDocumentField(field)
        ? e.message
        : `Invalid final confirmation field "${field}". Allowed: ${FINAL_CONFIRMATION_DOCUMENT_FIELDS.join(', ')}`;
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message,
          details: [{ field, message }]
        }
      });
      return;
    }

    const genericError = err as Error;
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: genericError.message || 'Invalid final confirmation upload payload'
      }
    });
  });
};

const handleQuotationDocumentsMultipart = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
  documentsUpload.fields(DOCUMENT_UPLOAD_FIELDS)(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    const e = err as MulterError;
    if (e.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'One or more files exceed the 30 MB maximum upload size'
        }
      });
      return;
    }
    if (e.code === 'LIMIT_UNEXPECTED_FILE' || e.code === 'LIMIT_FILE_COUNT') {
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

    const genericError = err as Error;
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: genericError.message || 'Invalid document upload payload'
      }
    });
  });
};

export const handleSingleQuotationDocumentUpload = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void => {
  documentsUpload.single('file')(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    const e = err as MulterError;
    if (e.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Uploaded file exceeds the 30 MB maximum upload size'
        }
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
    const genericError = err as Error;
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: genericError.message || 'Invalid document upload payload'
      }
    });
  });
};

const handleQuotationMeteringDetailsMultipart = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void => {
  documentsUpload.fields([
    { name: 'meterDocumentImage', maxCount: 1 },
    { name: 'meter_document_image', maxCount: 1 },
    { name: 'meterInstallationPhoto', maxCount: 1 },
    { name: 'meter_installation_photo', maxCount: 1 },
    { name: 'plantLivePhoto', maxCount: 1 },
    { name: 'plant_live_photo', maxCount: 1 }
  ])(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    const e = err as MulterError;
    if (e.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Uploaded file exceeds the 30 MB maximum upload size'
        }
      });
      return;
    }
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: e.message || 'Invalid multipart payload' }
    });
  });
};

const handleQuotationMeteringMcoMultipart = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void => {
  documentsUpload.fields([
    { name: 'workCompleteReportImage', maxCount: 1 },
    { name: 'meterInstalledPhoto', maxCount: 1 },
    { name: 'completeDcrReportImage', maxCount: 1 }
  ])(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    const e = err as MulterError;
    if (e.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'One or more MCO documents exceed the 30 MB maximum upload size'
        }
      });
      return;
    }
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: e.message || 'Invalid multipart payload' }
    });
  });
};

// Phone prefill — register before /:quotationId and before global authenticate (inventory agent JWT)
router.get(
  '/customer-by-phone',
  authenticateInventoryOrQuotation,
  authorizeQuotationCustomerByPhone,
  getQuotationCustomerByPhone
);

// All routes require authentication
router.use(authenticate);

// Read operations (GET) allow dealers, admins, and visitors
// Write operations (POST, PATCH) require dealer/admin only

/**
 * @swagger
 * /api/quotations:
 *   post:
 *     summary: Create a new quotation
 *     description: Create a new quotation with customer and product details
 *     tags: [Quotations]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - products
 *             properties:
 *               customerId:
 *                 type: string
 *                 description: Existing customer ID (optional if customer object provided)
 *               customer:
 *                 type: object
 *                 description: New customer object (optional if customerId provided)
 *                 properties:
 *                   firstName:
 *                     type: string
 *                   lastName:
 *                     type: string
 *                   mobile:
 *                     type: string
 *                   email:
 *                     type: string
 *                   address:
 *                     type: object
 *               products:
 *                 type: object
 *                 required:
 *                   - systemType
 *                 properties:
 *                   systemType:
 *                     type: string
 *                     enum: [on-grid, off-grid, hybrid, dcr, non-dcr, both, customize]
 *                   panelBrand:
 *                     type: string
 *                   panelSize:
 *                     type: string
 *                   panelQuantity:
 *                     type: integer
 *               discount:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *                 default: 0
 *     responses:
 *       201:
 *         description: Quotation created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Quotation'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 */
router.post('/', 
  authorizeDealer, 
  logRequestBeforeValidation,      // Log BEFORE validation
  validate(createQuotationSchema),  // Validation middleware
  logRequestAfterValidation,        // Log AFTER validation
  createQuotation
);

/**
 * @swagger
 * /api/quotations/product-catalog:
 *   get:
 *     summary: Get product catalog for product selection
 *     description: Returns the product catalog with all available brands, sizes, types, and options for use in product selection forms. Accessible to dealers, admins, and visitors.
 *     tags: [Quotations]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Product catalog retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProductCatalogResponse'
 *             example:
 *               success: true
 *               data:
 *                 panels:
 *                   brands: ["Adani", "Tata", "Waaree", "Vikram Solar", "RenewSys"]
 *                   sizes: ["440W", "445W", "540W", "545W", "550W", "555W"]
 *                 inverters:
 *                   types: ["String Inverter", "Micro Inverter", "Hybrid Inverter"]
 *                   brands: ["Growatt", "Solis", "Fronius", "Havells", "Polycab", "Delta"]
 *                   sizes: ["3kW", "5kW", "6kW", "8kW", "10kW", "15kW", "20kW", "25kW"]
 *                 structures:
 *                   types: ["GI Structure", "Aluminum Structure", "MS Structure"]
 *                   sizes: ["1kW", "2kW", "3kW", "5kW", "10kW", "15kW", "20kW"]
 *                 meters:
 *                   brands: ["L&T", "HPL", "Havells", "Genus", "Secure"]
 *                 cables:
 *                   brands: ["Polycab", "Havells", "KEI", "Finolex", "RR Kabel"]
 *                   sizes: ["4 sq mm", "6 sq mm", "10 sq mm", "16 sq mm", "25 sq mm"]
 *                 acdb:
 *                   options: ["1-String", "2-String", "3-String", "4-String"]
 *                 dcdb:
 *                   options: ["1-String", "2-String", "3-String", "4-String", "5-String"]
 *       401:
 *         description: Unauthorized - User not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error:
 *                 code: "AUTH_003"
 *                 message: "User not authenticated"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error:
 *                 code: "SYS_001"
 *                 message: "Internal server error"
 */
router.get('/product-catalog', rejectAccountManager, authorizeDealerAdminOrVisitor, getProductCatalog);

/** Alias for GET /api/config/pricing — used by quotation proposal UI */
router.get('/pricing-tables', rejectAccountManager, authorizeDealerAdminOrVisitor, getPricingTables);

/**
 * @swagger
 * /api/quotations:
 *   get:
 *     summary: Get all quotations with pagination
 *     description: Retrieve a list of quotations with optional filtering and pagination
 *     tags: [Quotations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Items per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected, completed]
 *         description: Filter by status
 *     responses:
 *       200:
 *         description: List of quotations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Quotation'
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *       401:
 *         description: Unauthorized
 */
router.get('/', authorizeDealerAdminOrVisitor, getQuotations);
router.get('/export', authorizeDealerAdminOrVisitor, downloadQuotationsExcel);

/**
 * @swagger
 * /api/quotations/{quotationId}:
 *   get:
 *     summary: Get quotation by ID
 *     description: Retrieve detailed information about a specific quotation. Dealers can see their own quotations, admins can see all, visitors can see quotations from their assigned visits.
 *     tags: [Quotations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: quotationId
 *         required: true
 *         schema:
 *           type: string
 *         description: Quotation ID
 *     responses:
 *       200:
 *         description: Quotation details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Quotation'
 *       403:
 *         description: Forbidden - Visitor trying to access quotation not assigned to them
 *       404:
 *         description: Quotation not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 */
router.get('/:quotationId', authorizeDealerAdminOrVisitor, getQuotationById);

/**
 * @swagger
 * /api/quotations/{quotationId}/discount:
 *   patch:
 *     summary: Update quotation discount
 *     description: Update the discount percentage for a quotation
 *     tags: [Quotations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: quotationId
 *         required: true
 *         schema:
 *           type: string
 *         description: Quotation ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - discount
 *             properties:
 *               discount:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *                 description: Discount percentage
 *     responses:
 *       200:
 *         description: Discount updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Quotation'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Quotation not found
 *       401:
 *         description: Unauthorized
 */
router.patch('/:quotationId/discount', authorizeDealerOrAccountManager, validate(updateDiscountSchema), updateQuotationDiscount);

/**
 * @swagger
 * /api/quotations/{quotationId}/products:
 *   patch:
 *     summary: Update quotation products/system configuration
 *     description: Update the system configuration and product details for a quotation
 *     tags: [Quotations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: quotationId
 *         required: true
 *         schema:
 *           type: string
 *         description: Quotation ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - products
 *             properties:
 *               products:
 *                 type: object
 *                 description: Updated products/system configuration
 *                 properties:
 *                   systemType:
 *                     type: string
 *                     enum: [on-grid, off-grid, hybrid, dcr, non-dcr, both, customize]
 *                   panelBrand:
 *                     type: string
 *                   panelSize:
 *                     type: string
 *                   panelQuantity:
 *                     type: integer
 *                   dcrPanelBrand:
 *                     type: string
 *                   dcrPanelSize:
 *                     type: string
 *                   dcrPanelQuantity:
 *                     type: integer
 *                   nonDcrPanelBrand:
 *                     type: string
 *                   nonDcrPanelSize:
 *                     type: string
 *                   nonDcrPanelQuantity:
 *                     type: integer
 *                   inverterType:
 *                     type: string
 *                   inverterBrand:
 *                     type: string
 *                   inverterSize:
 *                     type: string
 *                   structureType:
 *                     type: string
 *                   structureSize:
 *                     type: string
 *                   meterBrand:
 *                     type: string
 *                   customPanels:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         brand:
 *                           type: string
 *                         size:
 *                           type: string
 *                         quantity:
 *                           type: integer
 *                         type:
 *                           type: string
 *                           enum: [dcr, non-dcr]
 *     responses:
 *       200:
 *         description: Products updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     products:
 *                       type: object
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Quotation not found
 *       401:
 *         description: Unauthorized
 */
router.patch('/:quotationId/products', authorizeDealerOrAccountManager, validate(updateProductsSchema), updateQuotationProducts);

/**
 * @swagger
 * /api/quotations/{quotationId}/pricing:
 *   patch:
 *     summary: Update quotation pricing
 *     description: Update pricing fields including subtotal, subsidies, discount, and final amount
 *     tags: [Quotations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: quotationId
 *         required: true
 *         schema:
 *           type: string
 *         description: Quotation ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               subtotal:
 *                 type: number
 *                 description: Manual override of subtotal
 *               stateSubsidy:
 *                 type: number
 *                 description: State subsidy amount
 *               centralSubsidy:
 *                 type: number
 *                 description: Central subsidy amount
 *               discount:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *                 description: Discount percentage
 *               finalAmount:
 *                 type: number
 *                 description: Manual override of final amount
 *     responses:
 *       200:
 *         description: Pricing updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     pricing:
 *                       type: object
 *                       properties:
 *                         subtotal:
 *                           type: number
 *                         totalSubsidy:
 *                           type: number
 *                         stateSubsidy:
 *                           type: number
 *                         centralSubsidy:
 *                           type: number
 *                         amountAfterSubsidy:
 *                           type: number
 *                         discount:
 *                           type: number
 *                         discountAmount:
 *                           type: number
 *                         totalAmount:
 *                           type: number
 *                         finalAmount:
 *                           type: number
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Quotation not found
 *       401:
 *         description: Unauthorized
 */
router.patch('/:quotationId/pricing', authorizeDealerOrAccountManager, validate(updatePricingSchema), updateQuotationPricing);
router.post('/:quotationId/final-settlement', authorizeDealerOrAccountManager, validate(finalSettlementSchema), submitQuotationFinalSettlement);
router.post('/:quotationId/revert-final-settlement', authorizeDealerOrAccountManager, validate(revertFinalSettlementSchema), revertQuotationFinalSettlement);
router.delete('/:quotationId/final-settlement', authorizeDealerOrAccountManager, validate(revertFinalSettlementSchema), revertQuotationFinalSettlement);
router.patch('/:quotationId/payment-details', authorizeDealerOrAccountManager, validate(updatePaymentDetailsSchema), updateQuotationPaymentDetails);
router.patch('/:quotationId/installments', authorizeDealerOrAccountManager, validate(updatePaymentDetailsSchema), updateQuotationPaymentDetails);
router.put('/:quotationId/installments', authorizeDealerOrAccountManager, validate(updatePaymentDetailsSchema), updateQuotationPaymentDetails);
router.patch('/:quotationId/payment-mode', authorizeDealerOrAccountManager, validate(updatePaymentModeSchema), updateQuotationPaymentDetails);
/** §17 Bank process dual-track (SPA fallbacks + installer/metering JWT). */
router.patch(
  '/:quotationId/bank-process',
  authorizeMeteringOrAdmin,
  validate(bankProcessSchema),
  updateQuotationBankProcess
);
router.patch('/:quotationId/installation-release', authorizeDealerOrAccountManager, validate(updateInstallationReleaseSchema), updateQuotationInstallationRelease);
router.patch('/:quotationId/installation/ready', authorizeDealerOrAccountManager, validate(updateInstallationReleaseSchema), updateQuotationInstallationRelease);
router.patch('/:quotationId/installation-scheduled-at', authorizeAdmin, validate(updateInstallationScheduledAtSchema), updateQuotationInstallationScheduledAt);
router.patch('/:quotationId/installation-schedule', authorizeAdmin, validate(updateInstallationScheduledAtSchema), updateQuotationInstallationScheduledAt);
router.patch(
  '/:quotationId/installation-team',
  authorizeAdmin,
  validate(patchQuotationInstallationTeamSchema),
  patchQuotationInstallationTeam
);
router.patch(
  '/:quotationId/installation_team',
  authorizeAdmin,
  validate(patchQuotationInstallationTeamSchema),
  patchQuotationInstallationTeam
);

/** Fallback for stricter gateways: same handler as `PATCH /api/metering/quotations/:id/status`. */
router.patch(
  '/:quotationId/metering-status',
  authorizeMeteringOrAdmin,
  validate(meteringStatusSchema),
  meteringStatusUpdate
);

/** Fallback detail-save path used by some frontend clients. */
router.post(
  '/:quotationId/metering-details',
  authorizeMeteringOrAdmin,
  handleQuotationMeteringDetailsMultipart,
  validate(meteringDetailsSchema),
  saveMeteringDetails
);

router.post(
  '/:quotationId/metering-mco-documents',
  authorizeMeteringOrAdmin,
  handleQuotationMeteringMcoMultipart,
  validate(meteringMcoDocumentsSchema),
  saveMeteringMcoDocuments
);

router.post(
  '/:quotationId/documents',
  authorizeQuotationDocumentsEditor,
  handleQuotationDocumentsMultipart,
  saveQuotationDocuments
);

router.post(
  '/:quotationId/documents/upload',
  authorizeQuotationDocumentsEditor,
  handleSingleQuotationDocumentUpload,
  uploadQuotationDocument
);

/** §M — final confirmation batch upload (fallback path; preferred: POST /api/admin/…/final-confirmation-documents). */
router.post(
  '/:quotationId/final-confirmation-documents',
  authenticate,
  authorizeFinalConfirmationUploader,
  handleFinalConfirmationDocumentsMultipart,
  saveFinalConfirmationDocuments
);

/** Same handler as `POST /api/installer/quotations/:id/documents` — quotation-prefixed fallback for gateways/clients. */
router.post(
  '/:quotationId/installer-documents',
  authorizeInstallerOrAdmin,
  handleInstallerMultipart,
  validate(installerUploadMetaSchema),
  installerUploadDocuments
);

router.post(
  '/:quotationId/installer-documents/upload',
  authorizeInstallerOrAdmin,
  handleSingleInstallerUploadMultipart,
  uploadInstallerDocument
);

router.patch(
  '/:quotationId/documents',
  authorizeQuotationDocumentsEditor,
  handleQuotationDocumentsMultipart,
  saveQuotationDocuments
);

/**
 * @swagger
 * /api/quotations/{quotationId}/pdf:
 *   get:
 *     summary: Download quotation as PDF
 *     description: Generate and download a PDF version of the quotation
 *     tags: [Quotations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: quotationId
 *         required: true
 *         schema:
 *           type: string
 *         description: Quotation ID
 *     responses:
 *       200:
 *         description: PDF file
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Quotation not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 */
router.get('/:quotationId/pdf', rejectAccountManager, authorizeDealerAdminOrVisitor, downloadQuotationPDF);
router.get('/:quotationId/documents/view-url', authorizeDealerAdminOrVisitor, getQuotationDocumentViewUrl);
router.get('/:quotationId/documents/presign-url', authorizeDealerAdminOrVisitor, getQuotationDocumentViewUrl);
router.get('/:quotationId/documents/zip', authorizeDealerAdminOrVisitor, downloadQuotationDocumentsZip);

/**
 * @swagger
 * /api/quotations/{quotationId}/visits:
 *   get:
 *     summary: Get visits for a quotation
 *     description: Retrieve all visits associated with a specific quotation
 *     tags: [Quotations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: quotationId
 *         required: true
 *         schema:
 *           type: string
 *         description: Quotation ID
 *     responses:
 *       200:
 *         description: List of visits
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Visit'
 *       404:
 *         description: Quotation not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 */
router.get('/:quotationId/visits', rejectAccountManager, authorizeDealerAdminOrVisitor, getVisitsForQuotation);
router.patch(
  '/:quotationId/visits/:visitId/reschedule',
  rejectAccountManager,
  authorizeDealer,
  validate(rescheduleVisitSchema),
  rescheduleVisit
);
router.get('/:quotationId/workflow-history', authorizeDealerAdminOrVisitor, getWorkflowHistory);

export default router;


