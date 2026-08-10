import { Request, Response } from 'express';
import AWS from 'aws-sdk';
import path from 'path';
import archiver from 'archiver';
import { v4 as uuidv4 } from 'uuid';
import XLSX from 'xlsx';
import { Quotation, QuotationProduct, QuotationPaymentPhase, CustomPanel, Customer, Visit, VisitAssignment, SystemConfig, Dealer, QuotationDocument, QuotationInstallationDoc } from '../models/index-quotation';
import { Product } from '../models';
import { Op, Sequelize } from 'sequelize';
import { logError, logInfo } from '../utils/loggerHelper';
import { deleteFileFromS3IfExists } from '../middleware/upload';
import { decodeS3UrlPathToKey, generatePublicUrl, isPresignedS3GetUrl } from '../utils/s3Service';
import { normalizePaymentModeInput, isLoanOnlyPaymentType, FINAL_SETTLEMENT_LOAN_ONLY_MESSAGE } from '../utils/paymentMode';
import {
  normalizePaymentType,
  isPhaseModeAllowedForPaymentType,
  pickAmInstallmentPaymentCap,
  pickQuotationSubtotalForPayments,
  parseSiteCostFromBody
} from '../utils/cashLoanAmounts';
import {
  quotationAmountApiFields,
  quotationPaymentApiFields,
  quotationAdminMetadataFields,
  quotationProductEnrichmentFields,
  serializeInstallationReleaseFields,
  computeQuotationValidUntil,
  quotationProposalDateApiFields,
  touchQuotationProposalValidity
} from '../utils/quotationApiJson';
import {
  pushSystemHistory,
  swapSystemHistory,
  shouldPushSystemHistoryOnProductsPatch,
  quotationSystemHistoryApiFields,
  type QuotationSystemHistoryEntry
} from '../utils/quotationSystemHistory';
import {
  isAdditionalQuotationRequest,
  resolveSourceQuotationId,
  resolveQuotationCreateNotes,
  markQuotationAsCurrentForCustomer,
  quotationCurrentApiFields
} from '../utils/quotationAdditionalCreate';
import { persistQuotationSystemKw } from '../utils/persistQuotationSystemKw';
import {
  mapInstallationDocumentsForApi,
  quotationIdFromInstallationMediaRef,
  resolveInstallationMediaViewUrl
} from '../utils/installationDocumentsApi';
import {
  buildMeterDocumentApiFields,
  getLatestMeterDocMeta,
  resolveMeterStoredRef
} from '../utils/meteringMediaApi';
import { meteringWorkflowApiFields } from '../utils/meteringWorkflowApi';
import { paymentExcelJourneyApiFields } from '../utils/paymentExcelJourneyStatus';
import { installationPartialApiFields } from '../utils/installationPartialApi';
import { lookupQuotationCustomerByPhone } from '../utils/customerPhoneLookup';
import {
  loadQuotationPaymentPhases,
  replaceQuotationPaymentPhases,
  serializePaymentPhaseRow,
  shouldReplacePaymentPhases,
  upsertQuotationPaymentPhases,
  type PaymentPhaseRecord
} from '../utils/quotationPaymentPhases';
import {
  buildReleasedToInstallerWhere,
  isReleasedToInstallerListQuery
} from '../constants/workflowQueues';
import { extractS3KeyOrStoredPath } from '../utils/s3Service';
import {
  buildQuotationProductPdfPersistFields,
  buildQuotationProductPdfPersistFieldsForUpdate,
  buildQuotationProductInaPersistFields,
  buildQuotationProductInaPersistFieldsForUpdate,
  normalizeInaPackageProductFields,
  pickQuotationProductPersistPayload,
  hasPdfPanelRangeKey,
  isAllowedInverterBrandForCatalog,
  isAllowedMeterBrandForCatalog,
  isPdfPanelRangeDisplaySize,
  isCommercialRequestBody,
  readCommercialFlag,
  resolveCommercialFlag,
  commercialFlagDefinedInBody
} from '../utils/quotationProductPdfDisplay';
import {
  FINAL_CONFIRMATION_DOCUMENT_FIELDS,
  isFinalConfirmationDocumentField,
  buildFinalConfirmationApiFields
} from '../utils/finalConfirmationDocuments';
import { isPanelSizeAllowed, isAllowedPanelBrandForCatalog, normalizeProductCatalog } from '../utils/productCatalogNormalize';
import { isAllowedDisplayCableSize, isAsPerTheSet } from '../utils/productDisplayValues';
import {
  isTataDcrPackageSet,
  validateTataDcrProductSelection
} from '../utils/quotationTataDcrValidation';
import {
  isCromptonDcrSet,
  preserveCromptonSetIdentity,
  resolveDcrSetPriceForProducts,
  validateCromptonDcrProductSelection
} from '../utils/quotationCromptonDcr';
import { validateSubsidyForSystemType } from '../validations/quotationValidations';
import {
  isAllowedStandardImageOrPdfUpload,
  isAllowedStandardImageUpload,
  isAllowedPdfUpload,
  pdfOnlyValidationMessage,
  resolveImageContentTypeForUpload,
  standardImageOrPdfValidationMessage,
  standardImageValidationMessage
} from '../utils/uploadMimeTypes';

const PRODUCT_CATALOG_CACHE_TTL_MS = 60 * 1000;
let productCatalogCacheValue: any | null = null;
let productCatalogCacheUntil = 0;

// Helper function to get product catalog
const getProductCatalogData = async (): Promise<any> => {
  try {
    const now = Date.now();
    if (productCatalogCacheValue && productCatalogCacheUntil > now) {
      return productCatalogCacheValue;
    }

    const config = await SystemConfig.findByPk('product_catalog');
    if (!config) {
      const normalized = normalizeProductCatalog(null);
      productCatalogCacheValue = normalized;
      productCatalogCacheUntil = now + PRODUCT_CATALOG_CACHE_TTL_MS;
      return normalized;
    }
    const catalog = typeof config.configValue === 'string' 
      ? JSON.parse(config.configValue) 
      : config.configValue;
    const normalized = normalizeProductCatalog(catalog);
    productCatalogCacheValue = normalized;
    productCatalogCacheUntil = now + PRODUCT_CATALOG_CACHE_TTL_MS;
    return normalized;
  } catch (error) {
    logError('Failed to get product catalog', error);
    return normalizeProductCatalog(null);
  }
};

/** PATCH may send partial products — merge DB row so PDF keys / brands validate correctly. */
const mergeProductsForValidation = (
  incoming: Record<string, unknown>,
  existing: unknown
): Record<string, unknown> => {
  if (!existing || typeof existing !== 'object') return incoming;
  const plain =
    typeof (existing as { toJSON?: () => Record<string, unknown> }).toJSON === 'function'
      ? (existing as { toJSON: () => Record<string, unknown> }).toJSON()
      : (existing as Record<string, unknown>);
  return { ...plain, ...incoming };
};

const shouldSkipPanelSizeCatalogCheck = (
  products: Record<string, unknown>,
  pdfRangeActive: boolean,
  panelSize: unknown
): boolean => {
  if (pdfRangeActive) return true;
  if (isAsPerTheSet(panelSize)) return true;
  if (isPdfPanelRangeDisplaySize(panelSize)) return true;
  const brand = String(products.panelBrand ?? products.panel_brand ?? '').trim().toLowerCase();
  if (brand === 'ina' && Boolean(products.pdfUsePanelSizeRange ?? products.pdf_use_panel_size_range)) {
    return true;
  }
  return false;
};

// Get product catalog for product selection
export const getProductCatalog = async (_req: Request, res: Response): Promise<void> => {
  try {
    const catalog = await getProductCatalogData();

    if (!catalog) {
      // Return default empty structure if no catalog exists
      const defaultCatalog = normalizeProductCatalog(null);
      res.json({
        success: true,
        data: defaultCatalog
      });
      return;
    }

    res.json({
      success: true,
      data: catalog
    });
  } catch (error) {
    logError('Get product catalog error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Helper function to validate product selection against catalog
const validateProductSelection = (products: any, catalog: any): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!catalog) {
    // If no catalog exists, skip validation (allow any products)
    return { isValid: true, errors: [] };
  }

  if (isTataDcrPackageSet(products)) {
    const tataErrors = validateTataDcrProductSelection(products, catalog);
    return { isValid: tataErrors.length === 0, errors: tataErrors };
  }

  if (isCromptonDcrSet(products)) {
    const cromptonErrors = validateCromptonDcrProductSelection(products, catalog);
    return { isValid: cromptonErrors.length === 0, errors: cromptonErrors };
  }

  const pdfRangeActive = hasPdfPanelRangeKey(products);

  // Validate panel selection
  if (
    products.panelBrand &&
    catalog.panels?.brands &&
    !isAllowedPanelBrandForCatalog(products.panelBrand, catalog.panels.brands)
  ) {
    errors.push(`Invalid panel brand: ${products.panelBrand}`);
  }
  if (
    products.panelSize &&
    !shouldSkipPanelSizeCatalogCheck(products, pdfRangeActive, products.panelSize) &&
    catalog.panels?.sizes &&
    !isPanelSizeAllowed(products.panelSize, catalog.panels.sizes)
  ) {
    errors.push(`Invalid panel size: ${products.panelSize}`);
  }

  // Validate DCR panel selection
  if (
    products.dcrPanelBrand &&
    catalog.panels?.brands &&
    !isAllowedPanelBrandForCatalog(products.dcrPanelBrand, catalog.panels.brands)
  ) {
    errors.push(`Invalid DCR panel brand: ${products.dcrPanelBrand}`);
  }
  if (
    products.dcrPanelSize &&
    !shouldSkipPanelSizeCatalogCheck(products, pdfRangeActive, products.dcrPanelSize) &&
    catalog.panels?.sizes &&
    !isPanelSizeAllowed(products.dcrPanelSize, catalog.panels.sizes)
  ) {
    errors.push(`Invalid DCR panel size: ${products.dcrPanelSize}`);
  }

  // Validate non-DCR panel selection
  if (
    products.nonDcrPanelBrand &&
    catalog.panels?.brands &&
    !isAllowedPanelBrandForCatalog(products.nonDcrPanelBrand, catalog.panels.brands)
  ) {
    errors.push(`Invalid non-DCR panel brand: ${products.nonDcrPanelBrand}`);
  }
  if (
    products.nonDcrPanelSize &&
    !shouldSkipPanelSizeCatalogCheck(products, pdfRangeActive, products.nonDcrPanelSize) &&
    catalog.panels?.sizes &&
    !isPanelSizeAllowed(products.nonDcrPanelSize, catalog.panels.sizes)
  ) {
    errors.push(`Invalid non-DCR panel size: ${products.nonDcrPanelSize}`);
  }

  // Validate inverter selection
  // Only validate if catalog has defined options and allow custom values
  if (products.inverterType && catalog.inverters?.types && catalog.inverters.types.length > 0 && !catalog.inverters.types.includes(products.inverterType)) {
    errors.push(`Invalid inverter type: ${products.inverterType}`);
  }
  if (
    products.inverterBrand &&
    catalog.inverters?.brands &&
    catalog.inverters.brands.length > 0 &&
    !isAllowedInverterBrandForCatalog(products.inverterBrand, catalog.inverters.brands)
  ) {
    errors.push(`Invalid inverter brand: ${products.inverterBrand}`);
  }
  // Allow custom inverter sizes - only validate if catalog has sizes and user wants strict validation
  // For now, we allow any size to be entered even if not in catalog
  // if (products.inverterSize && catalog.inverters?.sizes && catalog.inverters.sizes.length > 0 && !catalog.inverters.sizes.includes(products.inverterSize)) {
  //   errors.push(`Invalid inverter size: ${products.inverterSize}`);
  // }

  // Validate structure selection
  if (
    products.structureType &&
    catalog.structures?.types?.length > 0 &&
    !catalog.structures.types.includes(products.structureType)
  ) {
    errors.push(`Invalid structure type: ${products.structureType}`);
  }
  // Allow custom structure sizes even if not in catalog
  // if (products.structureSize && catalog.structures?.sizes && !catalog.structures.sizes.includes(products.structureSize)) {
  //   errors.push(`Invalid structure size: ${products.structureSize}`);
  // }

  // Validate meter selection
  if (
    products.meterBrand &&
    catalog.meters?.brands &&
    catalog.meters.brands.length > 0 &&
    !isAllowedMeterBrandForCatalog(products.meterBrand, catalog.meters.brands)
  ) {
    errors.push(`Invalid meter brand: ${products.meterBrand}`);
  }

  // Validate AC cable selection
  if (
    products.acCableBrand &&
    catalog.cables?.brands?.length > 0 &&
    !catalog.cables.brands.includes(products.acCableBrand)
  ) {
    errors.push(`Invalid AC cable brand: ${products.acCableBrand}`);
  }
  if (
    products.acCableSize &&
    catalog.cables?.sizes &&
    !isAllowedDisplayCableSize(products.acCableSize, catalog.cables.sizes)
  ) {
    errors.push(`Invalid AC cable size: ${products.acCableSize}`);
  }

  // Validate DC cable selection
  if (
    products.dcCableBrand &&
    catalog.cables?.brands?.length > 0 &&
    !catalog.cables.brands.includes(products.dcCableBrand)
  ) {
    errors.push(`Invalid DC cable brand: ${products.dcCableBrand}`);
  }
  if (
    products.dcCableSize &&
    catalog.cables?.sizes &&
    !isAllowedDisplayCableSize(products.dcCableSize, catalog.cables.sizes)
  ) {
    errors.push(`Invalid DC cable size: ${products.dcCableSize}`);
  }

  // Validate ACDB / DCDB — allow empty / “As per the set” (PDF ≥20kW uses CT/BT client-side)
  if (
    products.acdb &&
    !isAsPerTheSet(products.acdb) &&
    catalog.acdb?.options?.length > 0 &&
    !catalog.acdb.options.includes(products.acdb)
  ) {
    errors.push(`Invalid ACDB option: ${products.acdb}`);
  }

  // Validate DCDB selection
  if (
    products.dcdb &&
    !isAsPerTheSet(products.dcdb) &&
    catalog.dcdb?.options?.length > 0 &&
    !catalog.dcdb.options.includes(products.dcdb)
  ) {
    errors.push(`Invalid DCDB option: ${products.dcdb}`);
  }

  // Validate custom panels if systemType is 'customize'
  if (products.systemType === 'customize' && products.customPanels) {
    for (const panel of products.customPanels) {
      if (panel.brand && catalog.panels?.brands && !isAllowedPanelBrandForCatalog(panel.brand, catalog.panels.brands)) {
        errors.push(`Invalid custom panel brand: ${panel.brand}`);
      }
      if (panel.size && catalog.panels?.sizes && !isPanelSizeAllowed(panel.size, catalog.panels.sizes)) {
        errors.push(`Invalid custom panel size: ${panel.size}`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

// Helper function to generate quotation ID
const generateQuotationId = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'QT-';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Helper function to calculate pricing
const calculatePricing = (products: any, discount: number = 0, discountAmountOverride?: number) => {
  const panelPrice = Number(products.panelPrice || 0);
  const inverterPrice = Number(products.inverterPrice || 0);
  const structurePrice = Number(products.structurePrice || 0);
  const meterPrice = Number(products.meterPrice || 0);
  const acCablePrice = Number(products.acCablePrice || 0);
  const dcCablePrice = Number(products.dcCablePrice || 0);
  const acdbPrice = Number(products.acdbPrice || 0);
  const dcdbPrice = Number(products.dcdbPrice || 0);
  const batteryPrice = Number(products.batteryPrice || 0);

  const cablePrice = acCablePrice + dcCablePrice;
  const acdbDcdbPrice = acdbPrice + dcdbPrice;

  const subtotal = panelPrice + inverterPrice + structurePrice + meterPrice + 
                   cablePrice + acdbDcdbPrice + batteryPrice;

  const centralSubsidy = Number(products.centralSubsidy || 0);
  const stateSubsidy = Number(products.stateSubsidy || 0);
  const totalSubsidy = centralSubsidy + stateSubsidy;

  // Total subsidies
  const totalSubsidyAmount = totalSubsidy;
  // Amount after subsidies
  const amountAfterSubsidy = subtotal - totalSubsidy;
  // Discount is applied to amount after subsidy
  const hasDiscountAmountOverride =
    discountAmountOverride !== undefined && discountAmountOverride !== null && !isNaN(Number(discountAmountOverride));
  const discountAmount = hasDiscountAmountOverride
    ? Number(discountAmountOverride)
    : (amountAfterSubsidy * discount) / 100;
  const totalAmount = amountAfterSubsidy - discountAmount;
  const finalAmount = totalAmount;

  return {
    panelPrice,
    inverterPrice,
    structurePrice,
    meterPrice,
    cablePrice,
    acdbDcdbPrice,
    subtotal,
    centralSubsidy,
    stateSubsidy,
    totalSubsidy: totalSubsidyAmount,
    totalAmount,
    amountAfterSubsidy,
    discountAmount,
    finalAmount
  };
};

const calculatePaymentStatus = (paidAmount: number | null | undefined, totalAmount: number) => {
  const paid = Number(paidAmount);
  if (isNaN(paid) || paid <= 0) {
    return 'pending';
  }
  if (paid >= totalAmount) {
    return 'completed';
  }
  return 'partial';
};

/** Total paid across installment phases (normalized rows). */
const sumPhasePaidAmounts = (phases: PaymentPhaseRecord[]): number =>
  phases.reduce((sum, p) => sum + Number(p.paidAmount || 0), 0);

/**
 * Remaining = amountAfterSubsidy − discountAmount − total paid.
 * Final Settlement writes off unpaid balance via discountAmount so remaining reaches 0.
 * Prefer amountAfterSubsidy (subtotal − subsidies), not raw subtotal.
 */
const remainingPaymentAgainstSubtotal = (
  amountAfterSubsidyOrSubtotal: number | null | undefined,
  totalPaid: number,
  discountAmount: number | null | undefined = 0
): number => {
  const base = Number(amountAfterSubsidyOrSubtotal) || 0;
  const discount = Math.max(0, Number(discountAmount) || 0);
  const paid = Number(totalPaid);
  const safePaid = isNaN(paid) ? 0 : paid;
  return Math.max(0, base - discount - safePaid);
};

/** Optional server guard: Final Settlement only for cash / mix (Cash + loan), not loan-only. */
const rejectLoanOnlyFinalSettlement = (quotation: unknown, res: Response): boolean => {
  if (!isLoanOnlyPaymentType(quotation as any)) return false;
  res.status(400).json({
    success: false,
    error: {
      code: 'VAL_016',
      message: FINAL_SETTLEMENT_LOAN_ONLY_MESSAGE,
      details: [
        {
          field: 'paymentType',
          message: 'Allowed payment types for final settlement: cash, mix'
        }
      ]
    }
  });
  return true;
};

/** Effective payable after subsidy + discount write-off (cap for paid totals). */
const effectivePayableCap = (
  amountAfterSubsidyOrSubtotal: number | null | undefined,
  discountAmount: number | null | undefined = 0
): number => {
  const base = Number(amountAfterSubsidyOrSubtotal) || 0;
  const discount = Math.max(0, Number(discountAmount) || 0);
  return Math.max(0, base - discount);
};

/** Resolve remaining + status for API. Never claim completed / remaining 0 while unpaid gap exists. */
const reconcilePaymentRemainingStatus = (
  storedStatus: string | null | undefined,
  amountAfterSubsidy: number,
  totalPaid: number,
  discountAmount: number
): { remaining: number; paymentStatus: 'pending' | 'partial' | 'completed' } => {
  const remaining = remainingPaymentAgainstSubtotal(
    amountAfterSubsidy,
    totalPaid,
    discountAmount
  );
  const paid = Number(totalPaid) || 0;
  if (remaining > 0.01) {
    return {
      remaining,
      paymentStatus: paid <= 0.01 ? 'pending' : 'partial'
    };
  }
  if (storedStatus === 'completed') {
    return { remaining: 0, paymentStatus: 'completed' };
  }
  const payable = effectivePayableCap(amountAfterSubsidy, discountAmount);
  const derived = calculatePaymentStatus(paid, payable) as 'pending' | 'partial' | 'completed';
  return { remaining: 0, paymentStatus: derived };
};

/** Resolve amount-after-subsidy from quotation columns or subtotal − subsidies. */
const resolveAmountAfterSubsidy = (
  quotation: {
    subtotal?: number | null;
    amountAfterSubsidy?: number | null;
    centralSubsidy?: number | null;
    stateSubsidy?: number | null;
  },
  products?: { centralSubsidy?: number | null; stateSubsidy?: number | null } | null,
  subtotalOverride?: number
): number => {
  const subtotal =
    subtotalOverride !== undefined
      ? subtotalOverride
      : Number(quotation.subtotal || 0);
  const rawStored = (quotation as any).amountAfterSubsidy;
  const stored = Number(rawStored);
  // Prefer persisted amountAfterSubsidy unless it looks unset (0 while subtotal > 0).
  if (
    subtotalOverride === undefined &&
    rawStored !== undefined &&
    rawStored !== null &&
    Number.isFinite(stored) &&
    !(stored === 0 && subtotal > 0)
  ) {
    return Math.max(0, stored);
  }
  const central = Number(
    products?.centralSubsidy ?? quotation.centralSubsidy ?? 0
  );
  const state = Number(products?.stateSubsidy ?? quotation.stateSubsidy ?? 0);
  return Math.max(0, subtotal - central - state);
};

const calculatePhaseStatus = (paidAmount: number, amount: number): 'pending' | 'partial' | 'completed' => {
  if (paidAmount <= 0) return 'pending';
  if (amount > 0 && paidAmount >= amount) return 'completed';
  return 'partial';
};

const normalizeDateString = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const normalizePaymentPhases = (phases: any[], updatedBy: string | null): PaymentPhaseRecord[] => {
  return phases
    .map((phase) => {
      const amount = Number(phase.amount ?? 0);
      const paidAmountRaw =
        phase.paidAmount ??
        phase.paid_amount ??
        phase.paidAmt ??
        phase.paid;
      const paidAmount = Number(paidAmountRaw ?? 0);
      const paymentMode = normalizePaymentModeInput(phase.paymentMode) ?? null;
      const computedStatus = calculatePhaseStatus(
        Number.isFinite(paidAmount) ? paidAmount : 0,
        Number.isFinite(amount) ? amount : 0
      );
      const inputStatus = phase.status ? String(phase.status) : undefined;
      const status: PaymentPhaseRecord['status'] =
        inputStatus && ['pending', 'partial', 'completed'].includes(inputStatus)
          ? (inputStatus as PaymentPhaseRecord['status'] === computedStatus ? (inputStatus as PaymentPhaseRecord['status']) : computedStatus)
          : computedStatus;

      const transactionIdRaw = phase.transactionId ?? phase.transaction_id;
      const noteRaw = phase.note;
      return {
        phaseNumber: Number(phase.phaseNumber),
        phaseName: String(phase.phaseName || '').trim(),
        amount: Number.isFinite(amount) ? amount : 0,
        paidAmount: Number.isFinite(paidAmount) ? paidAmount : 0,
        status,
        dueDate: normalizeDateString(phase.dueDate),
        paymentDate: normalizeDateString(phase.paymentDate),
        paymentMode,
        transactionId: transactionIdRaw ? String(transactionIdRaw) : null,
        note:
          noteRaw === undefined || noteRaw === null || String(noteRaw).trim() === ''
            ? null
            : String(noteRaw).trim(),
        updatedBy,
        updatedAt: new Date().toISOString()
      } as PaymentPhaseRecord;
    })
    .sort((a, b) => a.phaseNumber - b.phaseNumber);
};

const fetchPaymentPhasesByQuotationIds = async (quotationIds: string[]): Promise<Map<string, PaymentPhaseRecord[]>> => {
  const map = new Map<string, PaymentPhaseRecord[]>();
  if (!quotationIds.length) return map;

  const rows = await QuotationPaymentPhase.findAll({
    where: { quotationId: { [Op.in]: quotationIds } },
    order: [['quotationId', 'ASC'], ['phaseNumber', 'ASC']]
  });

  for (const row of rows as any[]) {
    const qId = String(row.quotationId);
    if (!map.has(qId)) map.set(qId, []);
    map.get(qId)!.push(serializePaymentPhaseRow(row));
  }

  return map;
};

const resolveActorForAudit = (req: Request): { actorId: string | null; actorRole: string | null } => {
  if (req.user?.id) return { actorId: req.user.id, actorRole: req.user.role || null };
  if (req.dealer?.id) return { actorId: req.dealer.id, actorRole: req.dealer.role || null };
  return { actorId: null, actorRole: null };
};

const resolveDealerIdForInventoryUser = async (userId: string, username?: string): Promise<string | null> => {
  const candidate = (username || '').trim();
  const orClauses: any[] = [];
  if (candidate) {
    orClauses.push({ username: candidate });
    if (candidate.includes('@')) {
      orClauses.push({ email: candidate });
    }
    if (/^\d+$/.test(candidate)) {
      orClauses.push({ mobile: candidate });
    }
  }
  orClauses.push({ id: userId });

  const dealer = await Dealer.findOne({
    where: { [Op.or]: orClauses },
    attributes: ['id']
  });
  return dealer ? dealer.id : null;
};

const normalizePhoneDigits = (value: unknown): string | null => {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length > 10) return digits.slice(-10);
  return null;
};

const resolveSellingPriceByName = async (name: string | null | undefined): Promise<number | null> => {
  if (!name) return null;
  const trimmed = String(name).trim();
  if (!trimmed) return null;
  const product = await Product.findOne({
    where: {
      name: {
        [Op.iLike]: trimmed
      }
    }
  });
  const sellingPrice = product?.selling_price;
  if (sellingPrice !== undefined && sellingPrice !== null) {
    return Number(sellingPrice);
  }
  const unitPrice = product?.unit_price;
  return unitPrice !== undefined && unitPrice !== null ? Number(unitPrice) : null;
};

const applySellingPricesForAgent = async (products: any): Promise<any> => {
  if (!products || typeof products !== 'object') {
    return products;
  }
  // Crompton DCR set uses package set-price from FE — do not overwrite with SKU matrix.
  if (isCromptonDcrSet(products)) {
    return products;
  }
  const updated = { ...products };

  const panelPrice = await resolveSellingPriceByName(products.panelBrand);
  if (panelPrice !== null) {
    const qty = Number(products.panelQuantity || 1);
    updated.panelPrice = panelPrice * (isNaN(qty) || qty <= 0 ? 1 : qty);
  }

  const inverterPrice = await resolveSellingPriceByName(products.inverterBrand);
  if (inverterPrice !== null) {
    updated.inverterPrice = inverterPrice;
  }

  const structurePrice = await resolveSellingPriceByName(products.structureType || products.structureSize);
  if (structurePrice !== null) {
    updated.structurePrice = structurePrice;
  }

  const meterPrice = await resolveSellingPriceByName(products.meterBrand);
  if (meterPrice !== null) {
    updated.meterPrice = meterPrice;
  }

  const acCablePrice = await resolveSellingPriceByName(products.acCableBrand);
  if (acCablePrice !== null) {
    updated.acCablePrice = acCablePrice;
  }

  const dcCablePrice = await resolveSellingPriceByName(products.dcCableBrand);
  if (dcCablePrice !== null) {
    updated.dcCablePrice = dcCablePrice;
  }

  const acdbPrice = await resolveSellingPriceByName(products.acdb);
  if (acdbPrice !== null) {
    updated.acdbPrice = acdbPrice;
  }

  const dcdbPrice = await resolveSellingPriceByName(products.dcdb);
  if (dcdbPrice !== null) {
    updated.dcdbPrice = dcdbPrice;
  }

  const batteryPrice = await resolveSellingPriceByName(products.batteryCapacity);
  if (batteryPrice !== null) {
    updated.batteryPrice = batteryPrice;
  }

  if (Array.isArray(products.customPanels)) {
    updated.customPanels = await Promise.all(products.customPanels.map(async (panel: any) => {
      const panelUnitPrice = await resolveSellingPriceByName(panel.brand);
      if (panelUnitPrice === null) return panel;
      const qty = Number(panel.quantity || 1);
      return {
        ...panel,
        price: panelUnitPrice * (isNaN(qty) || qty <= 0 ? 1 : qty)
      };
    }));
  }

  return updated;
};

// Create quotation
export const createQuotation = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    let { 
      customerId, 
      customer, 
      products, 
      discount = 0,
      subtotal,           // Set price (complete package price) - MUST BE SAVED
      centralSubsidy,      // Individual central subsidy
      stateSubsidy,        // Individual state subsidy
      totalSubsidy,       // Total subsidy (central + state)
      amountAfterSubsidy,  // Amount after subsidy
      discountAmount,      // Discount amount
      totalAmount,         // Amount after discount (Subtotal - Subsidy - Discount) - MUST BE SAVED
      finalAmount,         // Final amount (Subtotal - Subsidy, discount NOT applied) - MUST BE SAVED
      pricing: bodyPricing,
      paymentMode,
      paidAmount,
      paymentDate,
      paymentStatus
    } = req.body;
    
    // Log entire request body for debugging (excluding sensitive data)
    logInfo('Create quotation request received', {
      hasCustomerId: !!customerId,
      hasCustomer: !!customer,
      hasProducts: !!products,
      discount,
      subtotal: subtotal,
      subtotalValue: typeof subtotal,
      totalAmount: totalAmount,
      totalAmountType: typeof totalAmount,
      finalAmount: finalAmount,
      finalAmountType: typeof finalAmount,
      centralSubsidy: centralSubsidy,
      stateSubsidy: stateSubsidy,
      totalSubsidy: totalSubsidy,
      hasPricingObject: !!bodyPricing,
      requestBodyKeys: Object.keys(req.body),
      productsSystemPrice: products?.systemPrice,
      productsSystemPriceType: typeof products?.systemPrice,
      // Log raw values from req.body to see what was actually received
      rawSubtotal: req.body.subtotal,
      rawTotalAmount: req.body.totalAmount,
      rawFinalAmount: req.body.finalAmount,
      rawProductsSystemPrice: req.body.products?.systemPrice,
      paymentMode,
      paidAmount,
      paymentDate,
      paymentStatus
    });

    // Handle customer creation if customer object is provided
    let finalCustomerId = customerId;
    if (customer && !customerId) {
      const normalizedLastName = (customer.lastName ?? '').trim();
      const normalizedEmail = (customer.email ?? '').trim();
      // Check if customer exists by mobile
      const customerNotes = String(customer.notes ?? customer.remarks ?? '').trim() || null;
      let existingCustomer = await Customer.findOne({ where: { mobile: customer.mobile } });
      if (!existingCustomer) {
        try {
          existingCustomer = await Customer.create({
            id: uuidv4(),
            firstName: customer.firstName,
            lastName: normalizedLastName,
            mobile: customer.mobile,
            email: normalizedEmail !== '' ? normalizedEmail : null,
            streetAddress: customer.address.street,
            city: customer.address.city,
            state: customer.address.state,
            pincode: customer.address.pincode,
            notes: customerNotes,
            dealerId: req.dealer.id
          });
        } catch (createErr: any) {
          const msg = String(createErr?.parent?.message || createErr?.message || '');
          if (customerNotes && /column\s+"notes"/i.test(msg)) {
            existingCustomer = await Customer.create({
              id: uuidv4(),
              firstName: customer.firstName,
              lastName: normalizedLastName,
              mobile: customer.mobile,
              email: normalizedEmail !== '' ? normalizedEmail : null,
              streetAddress: customer.address.street,
              city: customer.address.city,
              state: customer.address.state,
              pincode: customer.address.pincode,
              dealerId: req.dealer.id
            });
          } else {
            throw createErr;
          }
        }
      } else {
        const updatePayload: Record<string, unknown> = {
          firstName: customer.firstName,
          lastName: normalizedLastName,
          email: normalizedEmail !== '' ? normalizedEmail : null,
          streetAddress: customer.address.street,
          city: customer.address.city,
          state: customer.address.state,
          pincode: customer.address.pincode
        };
        if (customerNotes) {
          updatePayload.notes = customerNotes;
        }
        try {
          await existingCustomer.update(updatePayload);
        } catch (updateErr: any) {
          const msg = String(updateErr?.parent?.message || updateErr?.message || '');
          if (customerNotes && /column\s+"notes"/i.test(msg)) {
            delete updatePayload.notes;
            await existingCustomer.update(updatePayload);
          } else {
            throw updateErr;
          }
        }
      }
      finalCustomerId = existingCustomer.id;
    }

    if (!finalCustomerId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_002',
          message: 'Customer ID or customer object is required'
        }
      });
      return;
    }

    // Verify customer belongs to dealer (admins can use any customer)
    const where: any = { id: finalCustomerId };
    if (req.dealer.role !== 'admin') {
      where.dealerId = req.dealer.id;
    }
    const customerRecord = await Customer.findOne({ where });

    if (!customerRecord) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Customer not found' }
      });
      return;
    }

    // Source-of-truth duplicate guard: prevent creating another active quotation
    // for the same customer mobile/customer record — unless §23 additional/revise flags.
    const allowAdditional = isAdditionalQuotationRequest(req.body as Record<string, unknown>);
    const sourceQuotationId = resolveSourceQuotationId(req.body as Record<string, unknown>);

    if (allowAdditional && sourceQuotationId) {
      const sourceWhere: any = { id: sourceQuotationId };
      if (req.dealer.role !== 'admin') {
        sourceWhere.dealerId = req.dealer.id;
      }
      const sourceQuotation = await Quotation.findOne({
        where: sourceWhere,
        attributes: ['id', 'dealerId', 'customerId']
      });
      if (!sourceQuotation) {
        res.status(400).json({
          success: false,
          error: {
            code: 'SOURCE_QUOTATION_MISSING',
            message: `sourceQuotationId ${sourceQuotationId} not found`
          }
        });
        return;
      }
      if (
        req.dealer.role !== 'admin' &&
        String(sourceQuotation.dealerId) !== String(req.dealer.id)
      ) {
        res.status(403).json({
          success: false,
          error: {
            code: 'SOURCE_QUOTATION_FORBIDDEN',
            message: 'sourceQuotationId is not owned by this dealer'
          }
        });
        return;
      }
    }

    if (!allowAdditional) {
      const duplicateWhere: any = {
        customerId: customerRecord.id,
        status: { [Op.notIn]: ['rejected', 'completed'] }
      };
      if (req.dealer.role !== 'admin') {
        duplicateWhere.dealerId = req.dealer.id;
      }
      const duplicateQuotation = await Quotation.findOne({
        where: duplicateWhere,
        attributes: ['id', 'status']
      });
      if (duplicateQuotation) {
        res.status(409).json({
          success: false,
          error: {
            code: 'CONFLICT_001',
            message: 'An active quotation already exists for this customer mobile',
            details: [{ field: 'customer.mobile', message: `Existing quotation: ${duplicateQuotation.id}` }]
          }
        });
        return;
      }
    }

    // Validate product selection against catalog
    const catalog = await getProductCatalogData();
    const validation = validateProductSelection(products, catalog);
    if (!validation.isValid) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_003',
          message: 'Invalid product selection',
          details: validation.errors.map(error => ({ message: error }))
        }
      });
      return;
    }

    const isAgentPricing = req.user?.role === 'agent' || (req.user?.role === 'dealer' && req.dealer?.role !== 'admin');
    if (isAgentPricing) {
      try {
        products = await applySellingPricesForAgent(products);
      } catch (agentPriceError) {
        logError('Agent selling price lookup failed; using submitted product prices', agentPriceError, {
          dealerId: req.dealer?.id
        });
      }
    }

    const discountAmountInput = discountAmount ?? req.body.pricing?.discountAmount;
    // Calculate pricing breakdown first (needed for fallback calculation)
    const pricing = calculatePricing(products, discount, discountAmountInput);
    
    // Check multiple possible locations for pricing fields
    // Priority: frontend value (root level) > pricing object > products.systemPrice > products.subtotal > calculated value
    // Values are at root level: req.body.subtotal, req.body.totalAmount, req.body.finalAmount
    // Helper to check if value is valid (not undefined, not null, and > 0)
    const isValidValue = (val: any): boolean => {
      if (val === undefined || val === null || val === '') {
        return false;
      }
      const numVal = Number(val);
      return !isNaN(numVal) && numVal > 0;
    };
    
    // Helper to check if value is valid number (including 0, for finalAmount)
    const isValidNumber = (val: any): boolean => {
      if (val === undefined || val === null || val === '') {
        return false;
      }
      const numVal = Number(val);
      return !isNaN(numVal) && numVal >= 0;
    };
    
    // Log what we're checking for subtotal extraction
    logInfo('Extracting subtotal value - checking all sources', {
      'req.body.subtotal': req.body.subtotal,
      'req.body.subtotal type': typeof req.body.subtotal,
      'req.body.pricing?.subtotal': req.body.pricing?.subtotal,
      'products?.systemPrice': products?.systemPrice,
      'products?.systemPrice type': typeof products?.systemPrice,
      'products?.subtotal': products?.subtotal,
      'products?.totalAmount': products?.totalAmount,
      'pricing.subtotal (calculated)': pricing.subtotal,
      'isValidValue(req.body.subtotal)': isValidValue(req.body.subtotal),
      'isValidValue(products?.systemPrice)': isValidValue(products?.systemPrice),
      'extracted subtotal (from destructuring)': subtotal
    });
    
    const cromptonSetPrice = resolveDcrSetPriceForProducts(products as Record<string, unknown>);
    const subtotalValue = isValidValue(subtotal)
      ? Number(subtotal)
      : (isValidValue(req.body.pricing?.subtotal)
          ? Number(req.body.pricing.subtotal)
          : (isValidValue(products?.systemPrice)
              ? Number(products.systemPrice)
              : (isValidValue(products?.subtotal)
                  ? Number(products.subtotal)
                  : (isValidValue(products?.totalAmount)
                      ? Number(products.totalAmount)
                      : (cromptonSetPrice !== null
                          ? cromptonSetPrice
                          : pricing.subtotal)))));
    
    logInfo('Subtotal extraction result', {
      subtotalValue,
      source: isValidValue(subtotal) ? 'req.body.subtotal' 
        : isValidValue(req.body.pricing?.subtotal) ? 'req.body.pricing.subtotal'
        : isValidValue(products?.systemPrice) ? 'products.systemPrice'
        : isValidValue(products?.subtotal) ? 'products.subtotal'
        : isValidValue(products?.totalAmount) ? 'products.totalAmount'
        : 'calculated (pricing.subtotal)'
    });
    
    const totalAmountValue = isValidNumber(totalAmount)
      ? Number(totalAmount)
      : (isValidNumber(req.body.pricing?.totalAmount)
          ? Number(req.body.pricing.totalAmount)
          : (isValidNumber(products?.totalAmount)
              ? Number(products.totalAmount)
              : null));
    
    const finalAmountValue = isValidNumber(finalAmount)
      ? Number(finalAmount)
      : (isValidNumber(req.body.pricing?.finalAmount)
          ? Number(req.body.pricing.finalAmount)
          : (isValidNumber(products?.finalAmount)
              ? Number(products.finalAmount)
              : null));
    
    // Log received values for debugging
    logInfo('Quotation pricing validation', {
      subtotalFromBody: subtotal,
      totalAmountFromBody: totalAmount,
      finalAmountFromBody: finalAmount,
      subtotalType: typeof subtotal,
      totalAmountType: typeof totalAmount,
      finalAmountType: typeof finalAmount,
      subtotalFromPricing: req.body.pricing?.subtotal,
      totalAmountFromPricing: req.body.pricing?.totalAmount,
      finalAmountFromPricing: req.body.pricing?.finalAmount,
      productsSystemPrice: products?.systemPrice,
      productsSubtotal: products?.subtotal,
      productsTotalAmount: products?.totalAmount,
      calculatedSubtotal: pricing.subtotal,
      finalSubtotalValue: subtotalValue,
      finalTotalAmountValue: totalAmountValue,
      finalFinalAmountValue: finalAmountValue,
      reqBodyRaw: JSON.stringify({
        subtotal: req.body.subtotal,
        totalAmount: req.body.totalAmount,
        finalAmount: req.body.finalAmount,
        productsSystemPrice: req.body.products?.systemPrice
      })
    });
    
    // Validate subtotal - use the extracted value (which already has fallback logic)
    const validatedSubtotal = Number(subtotalValue);
    
    // Check if subtotal is valid
    if (isNaN(validatedSubtotal)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Subtotal is required and must be a valid number',
          details: [{
            field: 'subtotal',
            message: `Subtotal must be a number. Received: ${subtotalValue}, Type: ${typeof subtotalValue}`
          }]
        }
      });
      return;
    }
    
    if (validatedSubtotal <= 0) {
      // Provide detailed error message showing what was received
      const receivedValues = {
        'req.body.subtotal': req.body.subtotal,
        'req.body.pricing?.subtotal': req.body.pricing?.subtotal,
        'products.subtotal': products?.subtotal,
        'products.systemPrice': products?.systemPrice,
        'products.totalAmount': products?.totalAmount,
        'calculated (pricing.subtotal)': pricing.subtotal,
        'extracted subtotalValue': subtotalValue
      };
      
      // Log the full request body for debugging (excluding sensitive data)
      logError('Subtotal validation failed', {
        receivedValues,
        requestBodyKeys: Object.keys(req.body),
        productsKeys: products ? Object.keys(products) : null,
        subtotalValue,
        validatedSubtotal
      });
      
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Subtotal is required and must be greater than 0',
          details: [{
            field: 'subtotal',
            message: `Subtotal must be greater than 0. Please provide 'subtotal' in the request body at the root level. Current value: ${validatedSubtotal}, Calculated from components: ${pricing.subtotal}`,
            receivedValues: receivedValues,
            suggestion: 'Send subtotal at root level: { "subtotal": 240000, "totalAmount": 162000, "finalAmount": 162000, ... }',
            help: 'The subtotal field must be included at the root level of the request body, not nested in products or pricing objects.'
          }]
        }
      });
      return;
    }

    // Commercial DCR/BOTH have no subsidy: force 0 and do not deduct from subtotal.
    const isCommercial = isCommercialRequestBody(req.body);
    const normalizedCentralSubsidy = isCommercial
      ? 0
      : Number(centralSubsidy ?? req.body.pricing?.centralSubsidy ?? products?.centralSubsidy ?? 0);
    const normalizedStateSubsidy = isCommercial
      ? 0
      : Number(stateSubsidy ?? req.body.pricing?.stateSubsidy ?? products?.stateSubsidy ?? 0);
    const normalizedTotalSubsidy = isCommercial
      ? 0
      : Number(totalSubsidy ?? req.body.pricing?.totalSubsidy ?? (normalizedCentralSubsidy + normalizedStateSubsidy));
    const normalizedAmountAfterSubsidy = isCommercial
      ? validatedSubtotal
      : Number(amountAfterSubsidy ?? req.body.pricing?.amountAfterSubsidy ?? (validatedSubtotal - normalizedTotalSubsidy));
    const parsedDiscountAmount = discountAmountInput !== undefined && discountAmountInput !== null && discountAmountInput !== ''
      ? Number(discountAmountInput)
      : NaN;
    const computedDiscountAmount = !isNaN(parsedDiscountAmount)
      ? parsedDiscountAmount
      : (normalizedAmountAfterSubsidy * Number(discount || 0)) / 100;
    const computedTotalAmount = normalizedAmountAfterSubsidy - computedDiscountAmount;
    const computedFinalAmount = computedTotalAmount;

    const validatedTotalAmount = totalAmountValue !== undefined && totalAmountValue !== null
      ? Number(totalAmountValue)
      : computedTotalAmount;
    const validatedFinalAmount = finalAmountValue !== undefined && finalAmountValue !== null
      ? Number(finalAmountValue)
      : computedFinalAmount;

    if (isNaN(validatedTotalAmount) || isNaN(validatedFinalAmount)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_002',
          message: 'Total amount or final amount is invalid',
          details: [{
            field: 'pricing',
            message: 'Total amount and final amount must be valid numbers'
          }]
        }
      });
      return;
    }

    // Use computed values so discountAmount always applies
    const finalPricing = {
      ...pricing,
      subtotal: validatedSubtotal,                    // Set price (complete package price)
      totalAmount: validatedTotalAmount,             // Amount after discount (Subtotal - Subsidy - Discount)
      finalAmount: validatedFinalAmount,              // Final amount after discount
      centralSubsidy: normalizedCentralSubsidy,
      stateSubsidy: normalizedStateSubsidy,
      totalSubsidy: normalizedTotalSubsidy,
      amountAfterSubsidy: normalizedAmountAfterSubsidy,
      discountAmount: computedDiscountAmount
    };

    // Generate quotation ID
    let quotationId = generateQuotationId();
    // Ensure unique ID
    while (await Quotation.findByPk(quotationId)) {
      quotationId = generateQuotationId();
    }

    const validUntil = computeQuotationValidUntil(new Date());

    const normalizedPaidAmount = paidAmount !== undefined && paidAmount !== null
      ? Number(paidAmount)
      : null;
    const normalizedPaymentStatus = normalizedPaidAmount !== null
      ? calculatePaymentStatus(normalizedPaidAmount, validatedTotalAmount)
      : (paymentStatus ?? null);

    const quotationCreateNotes = resolveQuotationCreateNotes(
      req.body as Record<string, unknown>,
      sourceQuotationId
    );

    // Create quotation - MUST save all pricing fields from frontend
    const quotation = await Quotation.create({
      id: quotationId,
      dealerId: req.dealer.id,
      customerId: finalCustomerId,
      systemType: products.systemType,
      status: 'pending',
      discount,
      subtotal: finalPricing.subtotal,                    // Set price (complete package price)
      totalAmount: finalPricing.totalAmount,             // Amount after discount (Subtotal - Subsidy - Discount)
      finalAmount: finalPricing.finalAmount,              // Final amount (Subtotal - Subsidy, discount NOT applied)
      centralSubsidy: finalPricing.centralSubsidy,       // Central government subsidy
      stateSubsidy: finalPricing.stateSubsidy,           // State subsidy
      totalSubsidy: finalPricing.totalSubsidy,           // Total subsidy (central + state)
      amountAfterSubsidy: finalPricing.amountAfterSubsidy, // Amount after subsidy
      discountAmount: finalPricing.discountAmount,       // Discount amount
      paymentMode: paymentMode ?? null,
      paidAmount: normalizedPaidAmount,
      paymentDate: paymentDate ?? null,
      paymentStatus: normalizedPaymentStatus,
      sourceQuotationId: sourceQuotationId || null,
      notes: quotationCreateNotes,
      isCurrent: true,
      validUntil
    });

    // §23: new row is Current; demote other quotations for same customer (keep old rows)
    try {
      await markQuotationAsCurrentForCustomer(finalCustomerId, quotation.id);
    } catch (currentErr) {
      logError('Mark quotation current on create failed (non-fatal)', currentErr, {
        quotationId: quotation.id,
        customerId: finalCustomerId
      });
    }

    const normalizedPhase = products.phase || '1-Phase';

    // Create quotation products
    logInfo('Saving quotation products phase', {
      quotationId: quotation.id,
      phase: normalizedPhase
    });
    const packageProducts = preserveCromptonSetIdentity(
      normalizeInaPackageProductFields(products as Record<string, unknown>)
    );
    const pdfPersistFields = buildQuotationProductPdfPersistFields(packageProducts);
    const inaPersistFields = buildQuotationProductInaPersistFields(packageProducts);

    await QuotationProduct.create({
      id: uuidv4(),
      quotationId: quotation.id,
      systemType: products.systemType,
      phase: normalizedPhase,
      ...pdfPersistFields,
      ...inaPersistFields,
      panelBrand: packageProducts.panelBrand ?? products.panelBrand,
      panelSize: products.panelSize,
      panelQuantity: products.panelQuantity,
      panelPrice: products.panelPrice,
      dcrPanelBrand: packageProducts.dcrPanelBrand ?? products.dcrPanelBrand,
      dcrPanelSize: products.dcrPanelSize,
      dcrPanelQuantity: products.dcrPanelQuantity,
      nonDcrPanelBrand: products.nonDcrPanelBrand,
      nonDcrPanelSize: products.nonDcrPanelSize,
      nonDcrPanelQuantity: products.nonDcrPanelQuantity,
      inverterType: products.inverterType,
      inverterBrand: packageProducts.inverterBrand ?? products.inverterBrand,
      inverterSize: packageProducts.inverterSize ?? products.inverterSize,
      inverterPrice: products.inverterPrice,
      structureType: products.structureType,
      structureSize: products.structureSize,
      structurePrice: products.structurePrice,
      meterBrand: products.meterBrand,
      meterPrice: products.meterPrice,
      acCableBrand: products.acCableBrand,
      acCableSize: products.acCableSize,
      acCablePrice: products.acCablePrice,
      dcCableBrand: products.dcCableBrand,
      dcCableSize: products.dcCableSize,
      dcCablePrice: products.dcCablePrice,
      acdb: packageProducts.acdb ?? products.acdb,
      acdbPrice: products.acdbPrice,
      dcdb: packageProducts.dcdb ?? products.dcdb,
      dcdbPrice: products.dcdbPrice,
      hybridInverter: products.hybridInverter,
      batteryCapacity: products.batteryCapacity,
      batteryPrice: products.batteryPrice,
      centralSubsidy: finalPricing.centralSubsidy,
      stateSubsidy: finalPricing.stateSubsidy,
      subtotal: finalPricing.subtotal,        // Set price (complete package price)
      totalAmount: finalPricing.totalAmount,  // Amount after discount (Subtotal - Subsidy - Discount)
      finalAmount: finalPricing.finalAmount   // Final amount (Subtotal - Subsidy, discount NOT applied)
    });

    // Handle custom panels if systemType is 'customize'
    if (products.systemType === 'customize' && products.customPanels) {
      for (const panel of products.customPanels) {
        await CustomPanel.create({
          id: uuidv4(),
          quotationId: quotation.id,
          brand: panel.brand,
          size: panel.size,
          quantity: panel.quantity,
          type: panel.type,
          price: panel.price
        });
      }
    }

    try {
      await persistQuotationSystemKw(quotation.id, quotation.systemType);
    } catch (persistErr) {
      logError('Persist system_kw on create failed (non-fatal)', persistErr, { quotationId: quotation.id });
    }

    logInfo('Quotation created', { quotationId: quotation.id, dealerId: req.dealer.id });

    res.status(201).json({
      success: true,
      data: {
        id: quotation.id,
        dealerId: quotation.dealerId,
        customerId: quotation.customerId,
        systemType: quotation.systemType,
        status: quotation.status,
        discount: quotation.discount,
        paymentMode: quotation.paymentMode,
        paymentType: (quotation as any).paymentType || null,
        paidAmount: quotation.paidAmount ? Number(quotation.paidAmount) : null,
        paymentDate: quotation.paymentDate,
        paymentStatus: quotation.paymentStatus,
        pricing: {
          subtotal: Number(quotation.subtotal),              // Set price (complete package price)
          totalAmount: Number(quotation.totalAmount),       // Amount after discount (Subtotal - Subsidy - Discount)
          finalAmount: Number(quotation.finalAmount),       // Final amount (Subtotal - Subsidy, discount NOT applied)
          centralSubsidy: Number((quotation as any).centralSubsidy || finalPricing.centralSubsidy || 0),
          stateSubsidy: Number((quotation as any).stateSubsidy || finalPricing.stateSubsidy || 0),
          totalSubsidy: Number((quotation as any).totalSubsidy || finalPricing.totalSubsidy || 0),
          amountAfterSubsidy: Number((quotation as any).amountAfterSubsidy || finalPricing.amountAfterSubsidy || 0),
          discountAmount: Number((quotation as any).discountAmount || finalPricing.discountAmount || 0),
          // Component prices for display
          panelPrice: finalPricing.panelPrice,
          inverterPrice: finalPricing.inverterPrice,
          structurePrice: finalPricing.structurePrice,
          meterPrice: finalPricing.meterPrice,
          cablePrice: finalPricing.cablePrice,
          acdbDcdbPrice: finalPricing.acdbDcdbPrice
        },
        sourceQuotationId: (quotation as any).sourceQuotationId || null,
        source_quotation_id: (quotation as any).sourceQuotationId || null,
        notes: (quotation as any).notes || null,
        isCurrent: true,
        is_current: true,
        ...quotationProposalDateApiFields(quotation)
      }
    });
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    logError('Create quotation error', error, {
      dealerId: req.dealer?.id,
      message: errMessage
    });
    const exposeDetail = process.env.NODE_ENV === 'development' || process.env.EXPOSE_API_ERRORS === 'true';
    res.status(500).json({
      success: false,
      error: {
        code: 'SYS_001',
        message: exposeDetail ? errMessage : 'Internal server error'
      }
    });
  }
};

/** Allowed ORDER BY columns for quotation lists (avoids invalid column SQL errors). */
const QUOTATION_LIST_SORT_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'id',
  'status',
  'validUntil',
  'dealerId',
  'subtotal',
  'totalAmount',
  'finalAmount',
  'discount',
  'approvedAt',
  'installationStatus',
  'installationReleasedAt'
]);

// Get quotations with pagination
export const getQuotations = async (req: Request, res: Response): Promise<void> => {
  try {
    // Authorization is handled by middleware (authorizeDealerAdminOrVisitor)
    const page = parseInt(req.query.page as string) || 1;
    const limitParam = req.query.limit as string | undefined;
    const wantsReleasedInstallerList = isReleasedToInstallerListQuery(req.query as Record<string, unknown>);
    const limit = limitParam
      ? Math.min(parseInt(limitParam) || 20, 1000)
      : wantsReleasedInstallerList
        ? 1000
        : undefined;
    const offset = limit ? (page - 1) * limit : undefined;
    const status = req.query.status as string;
    const search = req.query.search as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const paymentType = (req.query.paymentType as string | undefined) || (req.query.paymentMode as string | undefined);
    const paymentStatus = req.query.paymentStatus as string | undefined;
    const requestedSortBy = ((req.query.sortBy as string) || 'createdAt').trim();
    const safeSortBy = QUOTATION_LIST_SORT_FIELDS.has(requestedSortBy) ? requestedSortBy : 'createdAt';
    const sortDirRaw = ((req.query.sortOrder as string) || 'desc').toUpperCase();
    const sortOrder = sortDirRaw === 'ASC' ? 'ASC' : 'DESC';

    // Check if user is account manager
    const isAccountManager = req.user && (req.user.role === 'account-management' || req.user.role === 'hr');
    if (isAccountManager && status && status !== 'approved') {
      res.status(403).json({
        success: false,
        error: {
          code: 'AUTH_004',
          message: 'Insufficient permissions. Only approved quotations are available.'
        }
      });
      return;
    }

    // Admins can see all quotations, dealers only see their own, visitors see quotations from their visits
    // Account managers only see approved quotations
    let where: any = {};
    if (isAccountManager) {
      // Account managers can only see approved quotations
      where.status = 'approved';
    } else if (req.visitor) {
      // Visitors can only see quotations from their assigned visits
      const visitorAssignments = await VisitAssignment.findAll({
        where: { visitorId: req.visitor.id },
        attributes: ['visitId']
      });
      const visitIds = visitorAssignments.map(a => a.visitId);
      if (visitIds.length === 0) {
        // No visits assigned, return empty result
        res.json({
          success: true,
          data: {
            quotations: [],
            pagination: {
              page,
              limit,
              total: 0,
              totalPages: 0,
              hasNext: false,
              hasPrev: false
            }
          }
        });
        return;
      }
      const visits = await Visit.findAll({
        where: { id: visitIds },
        attributes: ['quotationId']
      });
      const quotationIds = visits.map(v => (v as any).quotationId).filter(Boolean);
      if (quotationIds.length === 0) {
        res.json({
          success: true,
          data: {
            quotations: [],
            pagination: {
              page,
              limit,
              total: 0,
              totalPages: 0,
              hasNext: false,
              hasPrev: false
            }
          }
        });
        return;
      }
      where.id = quotationIds;
    } else if (req.dealer) {
      // Dealers and admins
      where = req.dealer.role === 'admin' ? {} : { dealerId: req.dealer.id };
    } else if (req.user) {
      const isInventoryAdmin = req.user.role === 'admin' || req.user.role === 'super-admin' || req.user.role === 'super-admin-manager';
      const isInventoryAgent = req.user.role === 'agent' || req.user.role === 'account';
      if (isInventoryAdmin) {
        where = {};
      } else if (isInventoryAgent) {
        const mappedDealerId = await resolveDealerIdForInventoryUser(req.user.id, req.user.username);
        if (!mappedDealerId) {
          res.json({
            success: true,
            data: {
              quotations: [],
              pagination: {
                page,
                limit,
                total: 0,
                totalPages: 0,
                hasNext: false,
                hasPrev: false
              }
            }
          });
          return;
        }
        where.dealerId = mappedDealerId;
      }
    }

    // Account managers cannot override status filter - they only see approved
    // For others, allow status filter from query params
    if (!isAccountManager && status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate);
    }
    if (paymentType) {
      where[Op.or] = [
        ...(Array.isArray(where[Op.or]) ? where[Op.or] : []),
        { paymentType },
        { paymentMode: paymentType }
      ];
    }
    if (paymentStatus) {
      where.paymentStatus = paymentStatus;
    }
    if (wantsReleasedInstallerList) {
      if (!where.status) where.status = 'approved';
      where[Op.and] = [
        ...(Array.isArray(where[Op.and]) ? where[Op.and] : []),
        buildReleasedToInstallerWhere()
      ];
    }

    const listOrder: [string, string][] =
      wantsReleasedInstallerList && safeSortBy === 'createdAt'
        ? [['installationReleasedAt', 'DESC'], ['createdAt', 'DESC']]
        : [[safeSortBy, sortOrder]];

    let quotations;
    if (search) {
      // Search by quotation ID or customer name/mobile
      const whereWithSearch: any = {
        ...where,
        [Op.and]: [
          ...(Array.isArray(where[Op.and]) ? where[Op.and] : []),
          {
            [Op.or]: [
              { id: { [Op.iLike]: `%${search}%` } },
              Sequelize.where(Sequelize.col('customer.firstName'), { [Op.iLike]: `%${search}%` }),
              Sequelize.where(Sequelize.col('customer.lastName'), { [Op.iLike]: `%${search}%` }),
              Sequelize.where(Sequelize.col('customer.mobile'), { [Op.iLike]: `%${search}%` })
            ]
          }
        ]
      };
      quotations = await Quotation.findAndCountAll({
        where: whereWithSearch,
        include: [
          {
            model: Customer,
            as: 'customer',
            required: false
          },
          {
            model: QuotationProduct,
            as: 'products',
            required: false
          },
          {
            model: CustomPanel,
            as: 'customPanels',
            required: false
          },
          {
            model: QuotationDocument,
            as: 'documents',
            required: false
          },
          {
            model: Dealer,
            as: 'dealer',
            attributes: ['id', 'firstName', 'lastName', 'email', 'mobile', 'username', 'role'],
            required: false
          }
        ],
        limit,
        offset,
        order: listOrder
      });
    } else {
      quotations = await Quotation.findAndCountAll({
        where,
        include: [
          {
            model: Customer,
            as: 'customer',
            attributes: ['firstName', 'lastName', 'mobile']
          },
          {
            model: QuotationProduct,
            as: 'products',
            required: false
          },
          {
            model: CustomPanel,
            as: 'customPanels',
            required: false
          },
          {
            model: QuotationDocument,
            as: 'documents',
            required: false
          },
          {
            model: Dealer,
            as: 'dealer',
            attributes: ['id', 'firstName', 'lastName', 'email', 'mobile', 'username', 'role'],
            required: false
          }
        ],
        limit,
        offset,
        order: listOrder
      });
    }

    const quotationIds = quotations.rows.map((q: any) => String(q.id));
    const phaseMap = await fetchPaymentPhasesByQuotationIds(quotationIds);

    // Avoid costly JOIN fan-out on list queries; load installation docs in one batched query.
    const installationDocsByQuotationId = new Map<string, any[]>();
    if (quotationIds.length > 0) {
      const installationDocsRows = await QuotationInstallationDoc.findAll({
        where: { quotationId: { [Op.in]: quotationIds } },
        order: [['createdAt', 'ASC']]
      });
      for (const row of installationDocsRows as any[]) {
        const qId = String(row.quotationId);
        if (!installationDocsByQuotationId.has(qId)) installationDocsByQuotationId.set(qId, []);
        installationDocsByQuotationId.get(qId)!.push(row);
      }
    }

    const formattedQuotations = await Promise.all(quotations.rows.map(async q => {
      const customer = (q as any).customer;
      const products = (q as any).products;
      const dealer = (q as any).dealer;
      const documents = (q as any).documents;
      const installationDocs = installationDocsByQuotationId.get(String(q.id)) || [];
      const phaseRows = phaseMap.get(String(q.id)) || ((q as any).paymentPhases || []);
      const resolvedDocuments = await resolveQuotationDocumentUrls(documents);
      
      // Calculate pricing if products exist
      const pricing = products 
        ? calculatePricing(products, q.discount, (q as any).discountAmount)
        : null;

      const amountAfterSubsidyNum = resolveAmountAfterSubsidy(q as any, products);
      const totalPaidForRemaining =
        phaseRows.length > 0
          ? sumPhasePaidAmounts(phaseRows as PaymentPhaseRecord[])
          : Number(q.paidAmount || 0);
      const { remaining: remainingAmount, paymentStatus: reconciledPaymentStatus } =
        reconcilePaymentRemainingStatus(
          q.paymentStatus,
          amountAfterSubsidyNum,
          totalPaidForRemaining,
          Number((q as any).discountAmount || 0)
        );
      const qAny = q as any;
      const row =
        typeof qAny.get === 'function'
          ? (qAny.get({ plain: true }) as Record<string, unknown>)
          : (q as unknown as Record<string, unknown>);
      const resolvedDocsAny = (resolvedDocuments || {}) as any;
      const prefillPhoneNumber =
        resolvedDocsAny.phoneNumber ??
        resolvedDocsAny.phone_number ??
        customer?.mobile ??
        null;
      const prefillEmailId =
        resolvedDocsAny.emailId ??
        resolvedDocsAny.email_id ??
        customer?.email ??
        null;
      const prefillElectricityKno =
        resolvedDocsAny.electricityKno ??
        resolvedDocsAny.electricity_kno ??
        null;
      const customerTypeValue =
        (row as any).customerType ??
        (row as any).customer_type ??
        null;

      const rawInstallationDocs = installationDocs.map((doc: any) =>
        typeof doc.toJSON === 'function' ? doc.toJSON() : doc
      );
      const installationPayload = await mapInstallationDocumentsForApi(rawInstallationDocs);
      const latestMeterDoc = getLatestMeterDocMeta(rawInstallationDocs);
      const meterDocumentFields = await buildMeterDocumentApiFields(
        resolveMeterStoredRef((q as any).meterDocumentImageUrl, rawInstallationDocs),
        latestMeterDoc.name
      );

      const productListFields = quotationProductEnrichmentFields(
        products,
        (q as any).customPanels,
        q.systemType,
        (q as any).systemKw
      );

      return {
        id: q.id,
        dealerId: q.dealerId,
        dealer_id: q.dealerId,
        customerType: customerTypeValue,
        customer_type: customerTypeValue,
        dealer: dealer ? {
          id: dealer.id,
          firstName: dealer.firstName,
          lastName: dealer.lastName,
          email: dealer.email,
          mobile: dealer.mobile,
          username: dealer.username,
          role: dealer.role
        } : null,
        customer: customer ? {
          firstName: customer.firstName,
          lastName: customer.lastName ?? '',
          mobile: customer.mobile
        } : null,
        ...productListFields,
        systemType: q.systemType,
        ...quotationPaymentApiFields(row),
        ...quotationAdminMetadataFields(row),
        ...serializeInstallationReleaseFields(row),
        ...installationPartialApiFields({
          installationStatus: (q as any).installationStatus || 'pending_installer',
          installationPartialApproved: (q as any).installationPartialApproved,
          installationPartialApprovedAt: (q as any).installationPartialApprovedAt
        }),
        ...quotationAmountApiFields(row, pricing),
        paidAmount: q.paidAmount !== undefined && q.paidAmount !== null ? Number(q.paidAmount) : null,
        remaining: remainingAmount,
        remainingAmount,
        paymentDate: q.paymentDate,
        paymentStatus: reconciledPaymentStatus,
        installments: phaseRows,
        paymentPhases: phaseRows,
        payment_phases: phaseRows,
        installerApprovedAt: (q as any).installerApprovedAt || null,
        installer_approved_at: (q as any).installerApprovedAt || null,
        ...meteringWorkflowApiFields({
          installationStatus: (q as any).installationStatus || 'pending_installer',
          meteringApprovedAt: (q as any).meteringApprovedAt,
          mcoAt: (q as any).mcoAt,
          completionAt: (q as any).completionAt,
          meterInstallationPendingAt: (q as any).meterInstallationPendingAt,
          meteringWccAfterDiscom: (q as any).meteringWccAfterDiscom,
          meteringWccAfterDiscomAt: (q as any).meteringWccAfterDiscomAt
        }),
        ...paymentExcelJourneyApiFields({
          ...row,
          installationStatus: (q as any).installationStatus || 'pending_installer',
          meteringWccAfterDiscom: (q as any).meteringWccAfterDiscom,
          installationPartialApproved: (q as any).installationPartialApproved,
          installerApprovedAt: (q as any).installerApprovedAt
        }),
        discomName: (q as any).discomName || null,
        meterType: (q as any).meterType || null,
        meterNo: (q as any).meterNo || null,
        solarMeterNo: (q as any).solarMeterNo || null,
        netMeterNo: (q as any).netMeterNo || null,
        ...meterDocumentFields,
        installationDocuments: installationPayload.installationDocuments,
        installationPhotoUrls: installationPayload.installationPhotoUrls,
        installation_photo_urls: installationPayload.installationPhotoUrls,
        documents: {
          ...(resolvedDocuments || {}),
          ...installationPayload.documents
        },
        ...(await buildFinalConfirmationApiFields(resolvedDocuments)),
        ...installationPayload.installationFieldUrls,
        phoneNumber: prefillPhoneNumber,
        phone_number: prefillPhoneNumber,
        emailId: prefillEmailId,
        email_id: prefillEmailId,
        electricityKno: prefillElectricityKno,
        electricity_kno: prefillElectricityKno,
        pricing: pricing ? {
          subtotal: (q as any).subtotal !== undefined && (q as any).subtotal !== null 
            ? Number((q as any).subtotal) 
            : pricing.subtotal,
          totalAmount: (q as any).totalAmount !== undefined && (q as any).totalAmount !== null
            ? Number((q as any).totalAmount)
            : pricing.totalAmount,
          finalAmount: (q as any).finalAmount !== undefined && (q as any).finalAmount !== null
            ? Number((q as any).finalAmount)
            : pricing.finalAmount,
          amountAfterSubsidy: pricing.amountAfterSubsidy,
          discountAmount: Number((q as any).discountAmount ?? pricing.discountAmount ?? 0),
          discount_amount: Number((q as any).discountAmount ?? pricing.discountAmount ?? 0),
          totalSubsidy: pricing.totalSubsidy,
          centralSubsidy: pricing.centralSubsidy,
          stateSubsidy: pricing.stateSubsidy,
          finalSettlementApplied: !!(q as any).finalSettlementApplied,
          finalSettlementAmount:
            (q as any).finalSettlementAmount != null ? Number((q as any).finalSettlementAmount) : null
        } : null,
        status: q.status,
        discount: q.discount,
        discountAmount: Number((q as any).discountAmount || 0),
        discount_amount: Number((q as any).discountAmount || 0),
        ...quotationProposalDateApiFields(q),
        ...quotationCurrentApiFields(row)
      };
    }));

    res.json({
      success: true,
      data: {
        quotations: formattedQuotations,
        pagination: {
          page,
          limit: limit || quotations.count,
          total: quotations.count,
          totalPages: limit ? Math.ceil(quotations.count / limit) : 1,
          hasNext: limit ? page < Math.ceil(quotations.count / limit) : false,
          hasPrev: limit ? page > 1 : false
        }
      }
    });
  } catch (error) {
    logError('Get quotations error', error, { dealerId: req.dealer?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const downloadQuotationsExcel = async (req: Request, res: Response): Promise<void> => {
  try {
    const status = req.query.status as string | undefined;
    const search = req.query.search as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const paymentType = (req.query.paymentType as string | undefined) || (req.query.paymentMode as string | undefined);
    const paymentStatus = req.query.paymentStatus as string | undefined;

    const isAccountManager = req.user && (req.user.role === 'account-management' || req.user.role === 'hr');
    const where: any = {};

    if (isAccountManager) {
      where.status = 'approved';
    } else if (req.dealer) {
      where.dealerId = req.dealer.role === 'admin' ? { [Op.ne]: null } : req.dealer.id;
      if (req.dealer.role === 'admin') delete where.dealerId;
    } else if (req.user) {
      const isInventoryAdmin = req.user.role === 'admin' || req.user.role === 'super-admin' || req.user.role === 'super-admin-manager';
      const isInventoryAgent = req.user.role === 'agent' || req.user.role === 'account';
      if (isInventoryAgent && !isInventoryAdmin) {
        const mappedDealerId = await resolveDealerIdForInventoryUser(req.user.id, req.user.username);
        if (!mappedDealerId) {
          res.status(200).json({ success: true, data: { message: 'No data to export' } });
          return;
        }
        where.dealerId = mappedDealerId;
      }
    }

    if (!isAccountManager && status) where.status = status;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate);
    }
    if (paymentType) {
      where[Op.or] = [
        { paymentType },
        { paymentMode: paymentType }
      ];
    }
    if (paymentStatus) {
      where.paymentStatus = paymentStatus;
    }

    const include: any[] = [
      {
        model: Customer,
        as: 'customer',
        attributes: ['firstName', 'lastName', 'mobile'],
        required: false
      },
      {
        model: Dealer,
        as: 'dealer',
        attributes: ['firstName', 'lastName', 'mobile'],
        required: false
      }
    ];

    const whereWithSearch: any = search
      ? {
        ...where,
        [Op.and]: [
          ...(Array.isArray(where[Op.and]) ? where[Op.and] : []),
          {
            [Op.or]: [
              { id: { [Op.iLike]: `%${search}%` } },
              Sequelize.where(Sequelize.col('customer.firstName'), { [Op.iLike]: `%${search}%` }),
              Sequelize.where(Sequelize.col('customer.lastName'), { [Op.iLike]: `%${search}%` }),
              Sequelize.where(Sequelize.col('customer.mobile'), { [Op.iLike]: `%${search}%` })
            ]
          }
        ]
      }
      : where;

    const quotations = await Quotation.findAll({
      where: whereWithSearch,
      include,
      order: [['createdAt', 'DESC']]
    });

    const rows = quotations.map((q: any) => ({
      'Quotation ID': q.id,
      'Customer Name': `${q.customer?.firstName || ''} ${q.customer?.lastName || ''}`.trim(),
      'Mobile': q.customer?.mobile || '',
      'Payment Type': q.paymentType || q.paymentMode || '',
      'Bank & IFSC': (() => {
        const b = (q.bankName || '').trim();
        const i = (q.bankIfsc || '').trim();
        if (b && i) return `${b} · ${i}`;
        return b || i || '';
      })(),
      'Payment Status': q.paymentStatus || '',
      'Installments': Array.isArray(q.paymentPhases)
        ? q.paymentPhases.map((phase: any) => `${phase.phaseName || `Phase ${phase.phaseNumber}`}: ${Number(phase.paidAmount || 0)}/${Number(phase.amount || 0)} (${phase.status || ''})`).join(' | ')
        : '',
      'Subtotal': Number(q.subtotal || 0),
      'Paid': q.paidAmount !== null && q.paidAmount !== undefined ? Number(q.paidAmount) : 0,
      'Remaining': Math.max(0, Number(q.subtotal || 0) - Number(q.paidAmount || 0))
    }));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Payment Management');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const stamp = new Date().toISOString().slice(0, 10);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="payment-management-${stamp}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    logError('Download quotations excel error', error, { userId: req.user?.id, dealerId: req.dealer?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Lookup customer + address from latest quotation by mobile (inventory B2C prefill)
export const getQuotationCustomerByPhone = async (req: Request, res: Response): Promise<void> => {
  try {
    const normalizedPhone = normalizePhoneDigits(req.query.phone);
    if (!normalizedPhone) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: 'Valid phone query is required' }
      });
      return;
    }

    const result = await lookupQuotationCustomerByPhone(req, req.query.phone);
    if (!result) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Customer not found for this phone' }
      });
      return;
    }

    res.json(result);
  } catch (error) {
    logError('Get quotation customer by phone error', error, {
      phone: req.query.phone as string | undefined
    });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Get quotation by ID
export const getQuotationById = async (req: Request, res: Response): Promise<void> => {
  try {
    // Authorization is handled by middleware (authorizeDealerAdminOrVisitor)
    const { quotationId } = req.params;
    const where: any = { id: quotationId };
    
    // Check if user is account manager
    const isAccountManager = req.user && (req.user.role === 'account-management' || req.user.role === 'hr');
    
    // Check permissions
    if (isAccountManager) {
      // Account managers can only see approved quotations
      where.status = 'approved';
    } else if (req.visitor) {
      // Visitors can only see quotations from their assigned visits
      const visitorAssignments = await VisitAssignment.findAll({
        where: { visitorId: req.visitor.id },
        attributes: ['visitId']
      });
      const visitIds = visitorAssignments.map(a => a.visitId);
      if (visitIds.length > 0) {
        const visits = await Visit.findAll({
          where: { id: visitIds, quotationId },
          attributes: ['quotationId']
        });
        if (visits.length === 0) {
          res.status(403).json({
            success: false,
            error: { code: 'AUTH_004', message: 'Insufficient permissions' }
          });
          return;
        }
      } else {
        res.status(403).json({
          success: false,
          error: { code: 'AUTH_004', message: 'Insufficient permissions' }
        });
        return;
      }
    } else if (req.dealer) {
      // Admins can see all quotations, dealers only see their own
      if (req.dealer.role !== 'admin') {
        where.dealerId = req.dealer.id;
      }
    } else if (req.user) {
      const isInventoryAdmin = req.user.role === 'admin' || req.user.role === 'super-admin' || req.user.role === 'super-admin-manager';
      const isInventoryAgent = req.user.role === 'agent' || req.user.role === 'account';
      if (!isInventoryAdmin && isInventoryAgent) {
        const mappedDealerId = await resolveDealerIdForInventoryUser(req.user.id, req.user.username);
        if (!mappedDealerId) {
          res.status(403).json({
            success: false,
            error: { code: 'AUTH_004', message: 'Insufficient permissions' }
          });
          return;
        }
        where.dealerId = mappedDealerId;
      }
    }
    const quotation = await Quotation.findOne({
      where,
      include: [
        {
          model: Customer,
          as: 'customer'
        },
        {
          model: QuotationProduct,
          as: 'products'
        },
        {
          model: CustomPanel,
          as: 'customPanels'
        },
        {
          model: QuotationDocument,
          as: 'documents'
        },
        {
          model: QuotationInstallationDoc,
          as: 'installationDocs'
        },
        {
          model: Visit,
          as: 'visits',
          required: false,
          attributes: ['id', 'visitDate', 'visitTime', 'location', 'locationLink', 'status', 'createdAt'],
          include: [
            {
              model: VisitAssignment,
              as: 'assignments',
              required: false,
              attributes: ['visitorId', 'visitorName']
            }
          ]
        },
        {
          model: Dealer,
          as: 'dealer',
          attributes: ['id', 'firstName', 'lastName', 'email', 'mobile', 'username', 'role']
        }
      ]
    });

    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    const quotationAny = quotation as any;
    const phaseMap = await fetchPaymentPhasesByQuotationIds([String(quotation.id)]);
    const phaseRows = phaseMap.get(String(quotation.id)) || (quotationAny.paymentPhases || []);
    const products = quotationAny.products;
    const customer = quotationAny.customer;
    const dealer = quotationAny.dealer;
    const documents = quotationAny.documents;
    const installationDocs = quotationAny.installationDocs || [];
    const visits = quotationAny.visits || [];
    const resolvedDocuments = await resolveQuotationDocumentUrls(documents);
    
    // Calculate pricing breakdown (component prices for display)
    const pricing = calculatePricing(products || {}, quotation.discount, (quotation as any).discountAmount);
    
    // Use saved subtotal, totalAmount, and finalAmount from database (not recalculated)
    const finalPricing = {
      ...pricing,
      subtotal: Number(quotation.subtotal || pricing.subtotal),
      totalAmount: Number(quotation.totalAmount || pricing.totalAmount),
      finalAmount: Number(quotation.finalAmount || pricing.finalAmount)
    };

    const amountAfterSubsidyNum = resolveAmountAfterSubsidy(quotation as any, products);
    const totalPaidForRemaining =
      phaseRows.length > 0
        ? sumPhasePaidAmounts(phaseRows as PaymentPhaseRecord[])
        : Number(quotation.paidAmount || 0);
    const { remaining: remainingAmount, paymentStatus: reconciledPaymentStatus } =
      reconcilePaymentRemainingStatus(
        quotation.paymentStatus,
        amountAfterSubsidyNum,
        totalPaidForRemaining,
        Number((quotation as any).discountAmount || 0)
      );
    const rowById = quotation.get({ plain: true }) as unknown as Record<string, unknown>;
    const resolvedDocsAny = (resolvedDocuments || {}) as any;
    const prefillPhoneNumber =
      resolvedDocsAny.phoneNumber ??
      resolvedDocsAny.phone_number ??
      customer?.mobile ??
      null;
    const prefillEmailId =
      resolvedDocsAny.emailId ??
      resolvedDocsAny.email_id ??
      customer?.email ??
      null;
    const prefillElectricityKno =
      resolvedDocsAny.electricityKno ??
      resolvedDocsAny.electricity_kno ??
      null;
    const customerTypeValue =
      (rowById as any).customerType ??
      (rowById as any).customer_type ??
      null;

    const serializedVisits = (visits as any[]).map((visit: any) => {
      const assignedVisitors = (visit.assignments || []).map((a: any) => ({
        visitorId: a.visitorId || null,
        visitorName: a.visitorName || null,
        fullName: a.visitorName || null
      }));
      return {
        id: visit.id,
        visitDate: visit.visitDate || null,
        visitTime: visit.visitTime || null,
        status: visit.status || null,
        location: visit.location || null,
        visitLocation: visit.location || null,
        locationLink: visit.locationLink || null,
        visitors: assignedVisitors,
        assignedVisitors
      };
    });
    const primaryVisit = serializedVisits[0] || null;
    const rawInstallationDocs = installationDocs.map((doc: any) =>
      typeof doc.toJSON === 'function' ? doc.toJSON() : doc
    );
    const installationPayload = await mapInstallationDocumentsForApi(rawInstallationDocs);
    const latestMeterDoc = getLatestMeterDocMeta(rawInstallationDocs);
    const meterDocumentFields = await buildMeterDocumentApiFields(
      resolveMeterStoredRef(quotationAny.meterDocumentImageUrl, rawInstallationDocs),
      latestMeterDoc.name
    );

    res.json({
      success: true,
      data: {
        id: quotation.id,
        dealerId: quotation.dealerId,
        dealer_id: quotation.dealerId,
        customerType: customerTypeValue,
        customer_type: customerTypeValue,
        dealer: dealer ? {
          id: dealer.id,
          firstName: dealer.firstName,
          lastName: dealer.lastName,
          email: dealer.email,
          mobile: dealer.mobile,
          username: dealer.username,
          role: dealer.role
        } : null,
        customer: customer ? {
          id: customer.id,
          firstName: customer.firstName,
          lastName: customer.lastName ?? '',
          mobile: customer.mobile,
          email: customer.email ?? '',
          address: {
            street: customer.streetAddress,
            city: customer.city,
            state: customer.state,
            pincode: customer.pincode
          }
        } : null,
        systemType: quotation.systemType,
        ...quotationProductEnrichmentFields(
          products,
          quotationAny.customPanels,
          quotation.systemType,
          quotationAny.systemKw
        ),
        pricing: finalPricing,
        ...quotationAmountApiFields(rowById, finalPricing),
        status: quotation.status,
        ...serializeInstallationReleaseFields(rowById),
        installerApprovedAt: quotationAny.installerApprovedAt || null,
        installer_approved_at: quotationAny.installerApprovedAt || null,
        ...installationPartialApiFields({
          installationStatus: quotationAny.installationStatus || 'pending_installer',
          installationPartialApproved: quotationAny.installationPartialApproved,
          installationPartialApprovedAt: quotationAny.installationPartialApprovedAt
        }),
        ...meteringWorkflowApiFields({
          installationStatus: quotationAny.installationStatus || 'pending_installer',
          meteringApprovedAt: quotationAny.meteringApprovedAt,
          mcoAt: quotationAny.mcoAt,
          completionAt: quotationAny.completionAt,
          meterInstallationPendingAt: quotationAny.meterInstallationPendingAt,
          meteringWccAfterDiscom: quotationAny.meteringWccAfterDiscom,
          meteringWccAfterDiscomAt: quotationAny.meteringWccAfterDiscomAt
        }),
        ...paymentExcelJourneyApiFields({
          ...rowById,
          installationStatus: quotationAny.installationStatus || 'pending_installer',
          meteringWccAfterDiscom: quotationAny.meteringWccAfterDiscom,
          installationPartialApproved: quotationAny.installationPartialApproved,
          installerApprovedAt: quotationAny.installerApprovedAt
        }),
        discomName: quotationAny.discomName || null,
        meterType: quotationAny.meterType || null,
        meterNo: quotationAny.meterNo || null,
        solarMeterNo: quotationAny.solarMeterNo || null,
        netMeterNo: quotationAny.netMeterNo || null,
        ...meterDocumentFields,
        discount: quotation.discount,
        installationDocuments: installationPayload.installationDocuments,
        installationPhotoUrls: installationPayload.installationPhotoUrls,
        installation_photo_urls: installationPayload.installationPhotoUrls,
        ...installationPayload.installationFieldUrls,
        visits: serializedVisits,
        location: primaryVisit?.location || null,
        visitLocation: primaryVisit?.visitLocation || null,
        locationLink: primaryVisit?.locationLink || null,
        visitors: primaryVisit?.visitors || [],
        otherVisitors: primaryVisit?.assignedVisitors || [],
        assignedVisitors: primaryVisit?.assignedVisitors || [],
        documents: {
          ...(resolvedDocuments || {}),
          ...installationPayload.documents
        },
        ...(await buildFinalConfirmationApiFields(resolvedDocuments)),
        phoneNumber: prefillPhoneNumber,
        phone_number: prefillPhoneNumber,
        emailId: prefillEmailId,
        email_id: prefillEmailId,
        electricityKno: prefillElectricityKno,
        electricity_kno: prefillElectricityKno,
        ...quotationPaymentApiFields(rowById),
        ...quotationAdminMetadataFields(rowById),
        subtotal: Number(quotation.subtotal || finalPricing.subtotal),
        paidAmount: quotation.paidAmount ? Number(quotation.paidAmount) : null,
        remaining: remainingAmount,
        remainingAmount,
        paymentDate: quotation.paymentDate,
        paymentStatus: reconciledPaymentStatus,
        installments: phaseRows,
        paymentPhases: phaseRows,
        payment_phases: phaseRows,
        ...quotationProposalDateApiFields(quotation),
        ...quotationSystemHistoryApiFields(rowById),
        ...quotationCurrentApiFields(rowById),
        notes: (rowById as any).notes ?? null
      }
    });
  } catch (error) {
    logError('Get quotation by ID error', error, { quotationId: req.params.quotationId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Update quotation discount
export const updateQuotationDiscount = async (req: Request, res: Response): Promise<void> => {
  try {
    const isAccountManager = req.user && (req.user.role === 'account-management' || req.user.role === 'hr');
    const isInventoryAdmin =
      req.user &&
      (req.user.role === 'admin' ||
        req.user.role === 'super-admin' ||
        req.user.role === 'super-admin-manager');
    if (!req.dealer && !isAccountManager && !isInventoryAdmin) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { quotationId } = req.params;
    let discountAmount =
      req.body.discountAmount !== undefined && req.body.discountAmount !== null && req.body.discountAmount !== ''
        ? Number(req.body.discountAmount)
        : null;

    if (discountAmount !== null && (isNaN(discountAmount) || discountAmount < 0)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Discount amount must be a non-negative number',
          details: [{ field: 'discountAmount', message: 'Discount amount must be a non-negative number' }]
        }
      });
      return;
    }

    // Admins / AM can update approved quotations; dealers only their own
    const where: any = { id: quotationId };
    if (isAccountManager) {
      where.status = 'approved';
    } else if (req.dealer && req.dealer.role !== 'admin') {
      where.dealerId = req.dealer.id;
    }
    const quotation = await Quotation.findOne({
      where,
      include: [{ model: QuotationProduct, as: 'products' }]
    });

    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    // Absolute INR discount used by Final Settlement fallback — block loan-only.
    const rawForSettlementGuard = req.body.discount;
    const absoluteInrDiscount =
      (typeof rawForSettlementGuard === 'number' && rawForSettlementGuard > 100) ||
      (typeof rawForSettlementGuard === 'string' &&
        Number.isFinite(Number(rawForSettlementGuard)) &&
        Number(rawForSettlementGuard) > 100) ||
      req.body?.finalSettlementApplied === true;
    if (absoluteInrDiscount && rejectLoanOnlyFinalSettlement(quotation, res)) {
      return;
    }

    // Handle both number and string inputs. Convention: discount ≤ 100 → %; > 100 → absolute INR.
    const rawDiscount = req.body.discount;
    let discount: number =
      typeof rawDiscount === 'string'
        ? parseFloat(rawDiscount)
        : typeof rawDiscount === 'number'
          ? rawDiscount
          : NaN;

    if (!isNaN(discount) && discount > 100 && discountAmount === null) {
      // Absolute INR sent as `discount` (Final Settlement / edit dialog).
      discountAmount = discount;
    }

    if (discountAmount !== null && (rawDiscount === undefined || rawDiscount === null || rawDiscount === '')) {
      discount = Number(quotation.discount ?? 0);
    }
    if (discountAmount === null) {
      if (isNaN(discount) || discount < 0 || discount > 100) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_001',
            message: 'Discount must be between 0 and 100 (percentage), or > 100 for absolute INR',
            details: [{ field: 'discount', message: 'Discount must be between 0 and 100, or > 100 for absolute INR' }]
          }
        });
        return;
      }
    } else if (!isNaN(discount) && discount > 0 && discount <= 100 && rawDiscount !== undefined && rawDiscount !== null && rawDiscount !== '') {
      // Percentage provided alongside amount — keep % for storage only when not absolute.
    } else if (!isNaN(discount) && discount < 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Discount must be a non-negative number',
          details: [{ field: 'discount', message: 'Discount must be a non-negative number' }]
        }
      });
      return;
    }

    // Recalculate pricing with new discount — use saved amountAfterSubsidy when present
    const quotationAny = quotation as any;
    const savedSubtotal = Number(quotation.subtotal || 0);
    const centralSubsidy = Number(
      quotationAny.centralSubsidy ?? quotationAny.products?.centralSubsidy ?? 0
    );
    const stateSubsidy = Number(
      quotationAny.stateSubsidy ?? quotationAny.products?.stateSubsidy ?? 0
    );
    const totalSubsidy = centralSubsidy + stateSubsidy;
    const amountAfterSubsidy = resolveAmountAfterSubsidy(
      quotation as any,
      quotationAny.products
    );

    const percentForCalc =
      discountAmount === null
        ? discount
        : (!isNaN(discount) && discount >= 0 && discount <= 100 ? discount : 0);
    const computedDiscountAmount =
      discountAmount !== null
        ? discountAmount
        : (amountAfterSubsidy * percentForCalc) / 100;
    const newTotalAmount = Math.max(0, amountAfterSubsidy - computedDiscountAmount);
    const newFinalAmount = newTotalAmount;

    // Persist absolute INR on both fields when absolute; keep % when percentage-only.
    const discountFieldToStore =
      discountAmount !== null && (isNaN(discount) || discount > 100)
        ? computedDiscountAmount
        : discountAmount !== null && !isNaN(discount) && discount <= 100
          ? discount
          : discount;

    await quotation.update({
      discount: discountFieldToStore,
      totalAmount: newTotalAmount,
      finalAmount: newFinalAmount,
      discountAmount: computedDiscountAmount,
      remainingAmount: remainingPaymentAgainstSubtotal(
        amountAfterSubsidy,
        Number(quotation.paidAmount || 0),
        computedDiscountAmount
      ),
      validUntil: computeQuotationValidUntil(new Date())
    });

    await quotation.reload();

    res.json({
      success: true,
      data: {
        id: quotation.id,
        discount: quotation.discount,
        discountAmount: Number((quotation as any).discountAmount || computedDiscountAmount),
        discount_amount: Number((quotation as any).discountAmount || computedDiscountAmount),
        finalAmount: quotation.finalAmount,
        remaining: (quotation as any).remainingAmount ?? null,
        remainingAmount: (quotation as any).remainingAmount ?? null,
        pricing: {
          subtotal: savedSubtotal,
          totalAmount: newTotalAmount,
          finalAmount: newFinalAmount,
          amountAfterSubsidy: amountAfterSubsidy,
          discountAmount: computedDiscountAmount,
          totalSubsidy: totalSubsidy,
          centralSubsidy: centralSubsidy,
          stateSubsidy: stateSubsidy
        },
        ...quotationProposalDateApiFields(quotation)
      }
    });
  } catch (error) {
    logError('Update quotation discount error', error, { quotationId: req.params.quotationId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Update quotation products/system configuration
export const updateQuotationProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const isAccountManager = req.user && (req.user.role === 'account-management' || req.user.role === 'hr');
    const isInventoryAdmin =
      req.user &&
      (req.user.role === 'admin' ||
        req.user.role === 'super-admin' ||
        req.user.role === 'super-admin-manager');
    if (!req.dealer && !isAccountManager && !isInventoryAdmin) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { quotationId } = req.params;
    const { products } = req.body;

    // Admins can update all quotations, dealers only their own, account managers only approved
    const where: any = { id: quotationId };
    if (isAccountManager) {
      where.status = 'approved';
    } else if (req.dealer && req.dealer.role !== 'admin') {
      where.dealerId = req.dealer.id;
    }
    const quotation = await Quotation.findOne({
      where,
      include: [
        { model: QuotationProduct, as: 'products' },
        { model: CustomPanel, as: 'customPanels' }
      ]
    });

    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    const quotationAny = quotation as any;

    // Validate product selection against catalog (merge saved row + PATCH body)
    const catalog = await getProductCatalogData();
    const productsForValidation = mergeProductsForValidation(
      products as Record<string, unknown>,
      quotationAny.products
    );
    const validation = validateProductSelection(productsForValidation, catalog);
    if (!validation.isValid) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_003',
          message: 'Invalid product selection',
          details: validation.errors.map(error => ({ message: error }))
        }
      });
      return;
    }

    const existingProduct = quotationAny.products as { centralSubsidy?: number; stateSubsidy?: number; systemType?: string } | null;
    const effectiveSystemTypeForSubsidy =
      products.systemType || existingProduct?.systemType || quotation.systemType;
    const subsidyFieldsTouched =
      products.systemType !== undefined ||
      products.centralSubsidy !== undefined ||
      products.stateSubsidy !== undefined;
    if (subsidyFieldsTouched) {
      const existingProductRecord =
        existingProduct && typeof (existingProduct as { toJSON?: () => unknown }).toJSON === 'function'
          ? ((existingProduct as { toJSON: () => Record<string, unknown> }).toJSON() as Record<string, unknown>)
          : (existingProduct as Record<string, unknown> | null);
      const commercialForProducts =
        isCommercialRequestBody(req.body) ||
        readCommercialFlag(products as Record<string, unknown>) ||
        readCommercialFlag(existingProductRecord);
      // Commercial DCR/BOTH: force subsidies to 0 before persist / subsidy check.
      if (commercialForProducts) {
        products.centralSubsidy = 0;
        products.stateSubsidy = 0;
      }
      const subsidyCheck = validateSubsidyForSystemType(
        effectiveSystemTypeForSubsidy,
        Number(products.centralSubsidy ?? existingProduct?.centralSubsidy ?? quotation.centralSubsidy ?? 0),
        Number(products.stateSubsidy ?? existingProduct?.stateSubsidy ?? quotation.stateSubsidy ?? 0),
        commercialForProducts
      );
      if (!subsidyCheck.valid) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_001',
            message: 'Validation error',
            details: subsidyCheck.details
          }
        });
        return;
      }
    }

    const normalizedProducts = preserveCromptonSetIdentity(
      normalizeInaPackageProductFields(products as Record<string, unknown>)
    );
    const productPayload = pickQuotationProductPersistPayload(normalizedProducts);
    const pdfPersistFields = buildQuotationProductPdfPersistFieldsForUpdate(normalizedProducts);
    const inaPersistFields = {
      ...buildQuotationProductInaPersistFields(normalizedProducts),
      ...buildQuotationProductInaPersistFieldsForUpdate(normalizedProducts)
    };

    // §23: snapshot current products+pricing before overwrite (pricing-only PATCH does not push)
    if (
      shouldPushSystemHistoryOnProductsPatch(
        req.body as Record<string, unknown>,
        req.query as Record<string, unknown>
      )
    ) {
      const nextHistory = pushSystemHistory(
        quotation.get({ plain: true }) as unknown as Record<string, unknown>,
        quotationAny.products,
        quotationAny.customPanels
      );
      await quotation.update({ systemHistory: nextHistory });
    }

    // Update quotation system type if provided
    if (products.systemType) {
      await quotation.update({ systemType: products.systemType });
    }

    // Get or create quotation products record
    let quotationProduct = quotationAny.products || await QuotationProduct.findOne({
      where: { quotationId: quotation.id } 
    });

    if (!quotationProduct) {
      // Ensure required fields are present
      const phaseToSave = products.phase || '1-Phase';
      logInfo('Creating quotation products with phase', {
        quotationId: quotation.id,
        phase: phaseToSave
      });
      quotationProduct = await QuotationProduct.create({
        id: uuidv4(),
        quotationId: quotation.id,
        systemType: products.systemType || quotation.systemType,
        subtotal: Number(quotation.subtotal || 0),
        totalAmount: Number(quotation.totalAmount || 0),
        ...productPayload,
        ...buildQuotationProductPdfPersistFields(normalizedProducts),
        ...buildQuotationProductInaPersistFields(normalizedProducts),
        phase: phaseToSave
      });
    } else {
      logInfo('Updating quotation products phase', {
        quotationId: quotation.id,
        phase: products.phase || quotationProduct.phase || '1-Phase'
      });
      await quotationProduct.update({
        ...productPayload,
        ...pdfPersistFields,
        ...inaPersistFields,
        phase: products.phase || quotationProduct.phase || '1-Phase'
      });
    }

    const effectiveSystemType = products.systemType || quotationProduct?.systemType || quotation.systemType;

    // Handle custom panels updates safely for partial product updates
    if (effectiveSystemType === 'customize') {
      if (products.customPanels !== undefined) {
        await CustomPanel.destroy({ where: { quotationId: quotation.id } });
        if (Array.isArray(products.customPanels) && products.customPanels.length > 0) {
          await CustomPanel.bulkCreate(
            products.customPanels.map((panel: any) => ({
              id: uuidv4(),
              quotationId: quotation.id,
              brand: panel.brand,
              size: panel.size,
              quantity: panel.quantity,
              type: panel.type,
              price: panel.price
            }))
          );
        }
      }
    } else if (products.systemType !== undefined && products.systemType !== 'customize') {
      // Clear custom panels only when caller explicitly switches away from customize
      await CustomPanel.destroy({ where: { quotationId: quotation.id } });
    }

    // Recalculate pricing if needed (optional - can be done separately via pricing endpoint)
    // For now, we'll just update the products without recalculating pricing

    // Refresh quotation to get updated timestamp
    await quotation.reload();

    // Fetch updated quotation with all relations
    const updatedQuotation = await Quotation.findByPk(quotation.id, {
      include: [
        { model: QuotationProduct, as: 'products' },
        { model: CustomPanel, as: 'customPanels' }
      ]
    });

    try {
      await persistQuotationSystemKw(quotation.id, effectiveSystemType);
    } catch (persistErr) {
      logError('Persist system_kw on product update failed (non-fatal)', persistErr, {
        quotationId: quotation.id
      });
    }

    await touchQuotationProposalValidity(quotation);
    await updatedQuotation?.reload();

    const updatedQuotationAny = updatedQuotation as any;
    const productsRow = updatedQuotationAny?.products;
    const customPanelsData = updatedQuotationAny?.customPanels?.map((cp: any) => cp.toJSON()) || [];
    const productEnrichment = quotationProductEnrichmentFields(
      productsRow,
      customPanelsData,
      updatedQuotation?.systemType,
      updatedQuotationAny.systemKw
    );
    const mergedProducts = productEnrichment.products
      ? {
          ...productEnrichment.products,
          customPanels: customPanelsData.length > 0 ? customPanelsData : undefined
        }
      : null;

    const updatedPlain = updatedQuotation
      ? (updatedQuotation.get({ plain: true }) as unknown as Record<string, unknown>)
      : (quotation.get({ plain: true }) as unknown as Record<string, unknown>);

    res.json({
      success: true,
      data: {
        id: updatedQuotation?.id,
        systemType: updatedQuotation?.systemType,
        ...productEnrichment,
        products: mergedProducts,
        quotationProduct: mergedProducts,
        ...quotationProposalDateApiFields(updatedQuotation || quotation),
        ...quotationSystemHistoryApiFields(updatedPlain)
      }
    });
  } catch (error) {
    logError('Update quotation products error', error, { quotationId: req.params.quotationId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

/**
 * POST /quotations/:id/revert-system — restore last system_history entry (HANDOFF §23).
 * Same quotation id; customer unchanged; swaps current ↔ previous.
 */
export const revertQuotationSystem = async (req: Request, res: Response): Promise<void> => {
  try {
    const isAccountManager = req.user && (req.user.role === 'account-management' || req.user.role === 'hr');
    const isInventoryAdmin =
      req.user &&
      (req.user.role === 'admin' ||
        req.user.role === 'super-admin' ||
        req.user.role === 'super-admin-manager');
    if (!req.dealer && !isAccountManager && !isInventoryAdmin) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { quotationId } = req.params;
    const where: any = { id: quotationId };
    if (isAccountManager) {
      where.status = 'approved';
    } else if (req.dealer && req.dealer.role !== 'admin') {
      where.dealerId = req.dealer.id;
    }

    const quotation = await Quotation.findOne({
      where,
      include: [
        { model: QuotationProduct, as: 'products' },
        { model: CustomPanel, as: 'customPanels' },
        { model: Customer, as: 'customer' }
      ]
    });

    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    const quotationAny = quotation as any;
    const { previous, nextHistory } = swapSystemHistory(
      quotation.get({ plain: true }) as unknown as Record<string, unknown>,
      quotationAny.products,
      quotationAny.customPanels
    );

    if (!previous) {
      res.status(400).json({
        success: false,
        error: {
          code: 'NO_SYSTEM_HISTORY',
          message: 'No previous system configuration to revert to'
        }
      });
      return;
    }

    const restored = previous as QuotationSystemHistoryEntry;
    const prevProducts = { ...(restored.products || {}) } as Record<string, unknown>;
    const customPanelsSrc =
      restored.customPanels ||
      (Array.isArray(prevProducts.customPanels) ? (prevProducts.customPanels as Array<Record<string, unknown>>) : []);
    delete prevProducts.customPanels;

    const p = restored.pricing || {};
    const newSubtotal = Number(p.subtotal ?? quotation.subtotal ?? 0);
    const newStateSubsidy = Number(p.stateSubsidy ?? 0);
    const newCentralSubsidy = Number(p.centralSubsidy ?? 0);
    const newDiscountAmount = Number(p.discountAmount ?? quotation.discountAmount ?? 0);
    const newTotalAmount = Number(p.totalAmount ?? quotation.totalAmount ?? 0);
    const newFinalAmount = Number(p.finalAmount ?? quotation.finalAmount ?? newTotalAmount);
    const newTotalSubsidy = newStateSubsidy + newCentralSubsidy;
    const newAmountAfterSubsidy = Math.max(0, newSubtotal - newTotalSubsidy);
    const systemType = String(
      prevProducts.systemType || prevProducts.system_type || quotation.systemType
    ) as typeof quotation.systemType;

    const paidForRemaining = Number(quotation.paidAmount || 0);
    const computedRemaining = remainingPaymentAgainstSubtotal(
      newAmountAfterSubsidy,
      paidForRemaining,
      newDiscountAmount
    );

    await quotation.update({
      systemType,
      systemHistory: nextHistory,
      subtotal: newSubtotal,
      stateSubsidy: newStateSubsidy,
      centralSubsidy: newCentralSubsidy,
      totalSubsidy: newTotalSubsidy,
      amountAfterSubsidy: newAmountAfterSubsidy,
      discountAmount: newDiscountAmount,
      discount: newDiscountAmount,
      totalAmount: newTotalAmount,
      finalAmount: newFinalAmount,
      remainingAmount: computedRemaining,
      validUntil: computeQuotationValidUntil(new Date())
    });

    const normalizedProducts = preserveCromptonSetIdentity(
      normalizeInaPackageProductFields(prevProducts)
    );
    const productPayload = pickQuotationProductPersistPayload(normalizedProducts);
    const pdfPersistFields = {
      ...buildQuotationProductPdfPersistFields(normalizedProducts),
      ...buildQuotationProductPdfPersistFieldsForUpdate(normalizedProducts)
    };
    const inaPersistFields = {
      ...buildQuotationProductInaPersistFields(normalizedProducts),
      ...buildQuotationProductInaPersistFieldsForUpdate(normalizedProducts)
    };
    if (p.pdfCommercialSet !== undefined) {
      (productPayload as any).pdfCommercialSet = Boolean(p.pdfCommercialSet);
    }

    let quotationProduct =
      quotationAny.products ||
      (await QuotationProduct.findOne({ where: { quotationId: quotation.id } }));

    if (!quotationProduct) {
      quotationProduct = await QuotationProduct.create({
        id: uuidv4(),
        quotationId: quotation.id,
        systemType,
        subtotal: newSubtotal,
        totalAmount: newTotalAmount,
        finalAmount: newFinalAmount,
        stateSubsidy: newStateSubsidy,
        centralSubsidy: newCentralSubsidy,
        ...productPayload,
        ...pdfPersistFields,
        ...inaPersistFields,
        phase: (prevProducts.phase as string) || '1-Phase'
      });
    } else {
      await quotationProduct.update({
        systemType,
        subtotal: newSubtotal,
        totalAmount: newTotalAmount,
        finalAmount: newFinalAmount,
        stateSubsidy: newStateSubsidy,
        centralSubsidy: newCentralSubsidy,
        ...productPayload,
        ...pdfPersistFields,
        ...inaPersistFields,
        phase: (prevProducts.phase as string) || quotationProduct.phase || '1-Phase'
      });
    }

    await CustomPanel.destroy({ where: { quotationId: quotation.id } });
    if (systemType === 'customize' && Array.isArray(customPanelsSrc) && customPanelsSrc.length > 0) {
      await CustomPanel.bulkCreate(
        customPanelsSrc.map((panel: any) => ({
          id: uuidv4(),
          quotationId: quotation.id,
          brand: panel.brand,
          size: panel.size,
          quantity: panel.quantity,
          type: panel.type,
          price: panel.price
        }))
      );
    }

    try {
      await persistQuotationSystemKw(quotation.id, systemType);
    } catch (persistErr) {
      logError('Persist system_kw on system revert failed (non-fatal)', persistErr, {
        quotationId: quotation.id
      });
    }

    await touchQuotationProposalValidity(quotation);

    const updatedQuotation = await Quotation.findByPk(quotation.id, {
      include: [
        { model: QuotationProduct, as: 'products' },
        { model: CustomPanel, as: 'customPanels' },
        { model: Customer, as: 'customer' }
      ]
    });
    const updatedAny = updatedQuotation as any;
    const productsRow = updatedAny?.products;
    const customPanelsData = updatedAny?.customPanels?.map((cp: any) => cp.toJSON()) || [];
    const productEnrichment = quotationProductEnrichmentFields(
      productsRow,
      customPanelsData,
      updatedQuotation?.systemType,
      updatedAny?.systemKw
    );
    const mergedProducts = productEnrichment.products
      ? {
          ...productEnrichment.products,
          customPanels: customPanelsData.length > 0 ? customPanelsData : undefined
        }
      : null;
    const pricing = calculatePricing(
      productsRow || {},
      updatedQuotation!.discount,
      (updatedQuotation as any).discountAmount
    );
    const finalPricing = {
      ...pricing,
      subtotal: Number(updatedQuotation!.subtotal || pricing.subtotal),
      totalAmount: Number(updatedQuotation!.totalAmount || pricing.totalAmount),
      finalAmount: Number(updatedQuotation!.finalAmount || pricing.finalAmount)
    };
    const plain = updatedQuotation!.get({ plain: true }) as unknown as Record<string, unknown>;

    res.json({
      success: true,
      message: `Reverted to ${restored.label || 'previous system'}`,
      data: {
        id: updatedQuotation!.id,
        systemType: updatedQuotation!.systemType,
        ...productEnrichment,
        products: mergedProducts,
        quotationProduct: mergedProducts,
        pricing: finalPricing,
        ...quotationAmountApiFields(plain, finalPricing),
        customer: updatedAny.customer
          ? {
              id: updatedAny.customer.id,
              firstName: updatedAny.customer.firstName,
              lastName: updatedAny.customer.lastName ?? '',
              mobile: updatedAny.customer.mobile,
              email: updatedAny.customer.email ?? ''
            }
          : null,
        ...quotationProposalDateApiFields(updatedQuotation!),
        ...quotationSystemHistoryApiFields(plain)
      }
    });
  } catch (error) {
    logError('Revert quotation system error', error, { quotationId: req.params.quotationId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

/**
 * POST /quotations/:id/restore-current — make this quotation Current (HANDOFF §23).
 * Other same-customer quotations become Previous. No rows deleted.
 */
export const restoreQuotationCurrent = async (req: Request, res: Response): Promise<void> => {
  try {
    const isAccountManager = req.user && (req.user.role === 'account-management' || req.user.role === 'hr');
    const isInventoryAdmin =
      req.user &&
      (req.user.role === 'admin' ||
        req.user.role === 'super-admin' ||
        req.user.role === 'super-admin-manager');
    if (!req.dealer && !isAccountManager && !isInventoryAdmin) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { quotationId } = req.params;

    // PATCH fallback from FE restoreAsCurrent: require { isCurrent: true }.
    if (String(req.method || '').toUpperCase() === 'PATCH') {
      const body = (req.body || {}) as Record<string, unknown>;
      const wantsCurrent =
        body.isCurrent === true ||
        body.is_current === true ||
        body.setAsCurrent === true ||
        body.set_as_current === true;
      if (!wantsCurrent) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_001',
            message: 'PATCH /quotations/:id supports restoring current via { isCurrent: true }'
          }
        });
        return;
      }
    }

    const where: any = { id: quotationId };
    if (isAccountManager) {
      where.status = 'approved';
    } else if (req.dealer && req.dealer.role !== 'admin') {
      where.dealerId = req.dealer.id;
    }

    const quotation = await Quotation.findOne({
      where,
      include: [
        { model: QuotationProduct, as: 'products' },
        { model: Customer, as: 'customer' }
      ]
    });

    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    await markQuotationAsCurrentForCustomer(quotation.customerId, quotation.id);
    await quotation.reload();

    const plain = quotation.get({ plain: true }) as unknown as Record<string, unknown>;
    const quotationAny = quotation as any;
    const productEnrichment = quotationProductEnrichmentFields(
      quotationAny.products,
      quotationAny.customPanels,
      quotation.systemType,
      quotationAny.systemKw
    );

    res.json({
      success: true,
      message: `${quotation.id} restored as current quotation`,
      data: {
        id: quotation.id,
        customerId: quotation.customerId,
        systemType: quotation.systemType,
        status: quotation.status,
        ...productEnrichment,
        ...quotationCurrentApiFields(plain),
        ...quotationProposalDateApiFields(quotation)
      }
    });
  } catch (error) {
    logError('Restore quotation current error', error, { quotationId: req.params.quotationId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Update quotation pricing
export const updateQuotationPricing = async (req: Request, res: Response): Promise<void> => {
  try {
    const isAccountManager = req.user && (req.user.role === 'account-management' || req.user.role === 'hr');
    const isInventoryAdmin =
      req.user &&
      (req.user.role === 'admin' ||
        req.user.role === 'super-admin' ||
        req.user.role === 'super-admin-manager');
    if (!req.dealer && !isAccountManager && !isInventoryAdmin) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { quotationId } = req.params;
    const { 
      subtotal, 
      stateSubsidy, 
      centralSubsidy, 
      discount,
      discountAmount,
      finalAmount,
      paymentMode,
      paidAmount,
      paymentDate,
      paymentStatus
    } = req.body;

    const toFiniteNumber = (value: unknown): number | undefined => {
      if (value === undefined || value === null) return undefined;
      if (typeof value === 'string' && value.trim() === '') return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    const details: Array<{ field: string; message: string }> = [];
    if (subtotal !== undefined && toFiniteNumber(subtotal) === undefined) {
      details.push({ field: 'subtotal', message: 'subtotal must be a valid number' });
    }
    if (stateSubsidy !== undefined && toFiniteNumber(stateSubsidy) === undefined) {
      details.push({ field: 'stateSubsidy', message: 'stateSubsidy must be a valid number' });
    }
    if (centralSubsidy !== undefined && toFiniteNumber(centralSubsidy) === undefined) {
      details.push({ field: 'centralSubsidy', message: 'centralSubsidy must be a valid number' });
    }
    if (discount !== undefined && toFiniteNumber(discount) === undefined) {
      details.push({ field: 'discount', message: 'discount must be a valid number' });
    }
    if (discountAmount !== undefined && toFiniteNumber(discountAmount) === undefined) {
      details.push({ field: 'discountAmount', message: 'discountAmount must be a valid number' });
    }
    if (finalAmount !== undefined && toFiniteNumber(finalAmount) === undefined) {
      details.push({ field: 'finalAmount', message: 'finalAmount must be a valid number' });
    }
    if (paidAmount !== undefined && toFiniteNumber(paidAmount) === undefined) {
      details.push({ field: 'paidAmount', message: 'paidAmount must be a valid number' });
    }
    if (details.length > 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Validation error',
          details
        }
      });
      return;
    }

    // Account managers are allowed to edit pricing for approved quotations

    // Admins can update all quotations, dealers only their own
    const where: any = { id: quotationId };
    if (isAccountManager) {
      where.status = 'approved';
    } else if (req.dealer && req.dealer.role !== 'admin') {
      where.dealerId = req.dealer.id;
    }
    const quotation = await Quotation.findOne({
      where,
      include: [{ model: QuotationProduct, as: 'products' }]
    });

    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    // Settlement-style pricing write (FE finalizeSettlement fallback): block loan-only.
    // FE sends { discountAmount, totalAmount, finalAmount } without subtotal.
    const looksLikeSettlementPricing =
      req.body?.finalSettlementApplied === true ||
      (String(req.body?.paymentStatus || '').toLowerCase() === 'completed' &&
        (Number(req.body?.remaining) === 0 || Number(req.body?.remainingAmount) === 0)) ||
      (discountAmount !== undefined && subtotal === undefined && finalAmount !== undefined);
    if (looksLikeSettlementPricing && rejectLoanOnlyFinalSettlement(quotation, res)) {
      return;
    }

    const quotationAny = quotation as any;
    const currentProducts = quotationAny.products || {};

    // Commercial DCR/BOTH have no subsidy: force 0 and do not deduct from subtotal.
    const isCommercial = resolveCommercialFlag(req.body, currentProducts as Record<string, unknown>);

    // Get current values or use provided values — subtotal optional (Final Settlement omits it)
    const newSubtotal = subtotal !== undefined ? Number(toFiniteNumber(subtotal)) : Number(quotation.subtotal || 0);
    const newStateSubsidy = isCommercial
      ? 0
      : (stateSubsidy !== undefined
        ? Number(toFiniteNumber(stateSubsidy))
        : Number(currentProducts.stateSubsidy ?? (quotation as any).stateSubsidy ?? 0));
    const newCentralSubsidy = isCommercial
      ? 0
      : (centralSubsidy !== undefined
        ? Number(toFiniteNumber(centralSubsidy))
        : Number(currentProducts.centralSubsidy ?? (quotation as any).centralSubsidy ?? 0));
    const newDiscountRaw = discount !== undefined 
      ? Number(toFiniteNumber(discount))
      : Number(quotation.discount || 0);
    const newFinalAmount = finalAmount !== undefined ? Number(toFiniteNumber(finalAmount)) : undefined;
    let newDiscountAmount = discountAmount !== undefined && discountAmount !== null && discountAmount !== ''
      ? Number(toFiniteNumber(discountAmount))
      : undefined;

    // Convention: discount > 100 without discountAmount → absolute INR
    if (newDiscountAmount === undefined && discount !== undefined && newDiscountRaw > 100) {
      newDiscountAmount = newDiscountRaw;
    }
    const newDiscount = newDiscountRaw;

    // Validate discount range
    if (newDiscountAmount !== undefined && (isNaN(newDiscountAmount) || newDiscountAmount < 0)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Discount amount must be a non-negative number',
          details: [{ field: 'discountAmount', message: 'Discount amount must be a non-negative number' }]
        }
      });
      return;
    }

    if (
      newDiscountAmount === undefined &&
      discount !== undefined &&
      (isNaN(newDiscount) || newDiscount < 0 || newDiscount > 100)
    ) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Discount must be between 0 and 100 (percentage), or > 100 for absolute INR',
          details: [{ field: 'discount', message: 'Discount must be between 0 and 100, or > 100 for absolute INR' }]
        }
      });
      return;
    }

    // Validate subtotal only when explicitly sent
    if (subtotal !== undefined && (isNaN(newSubtotal) || newSubtotal <= 0)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Subtotal must be greater than 0',
          details: [{ field: 'subtotal', message: 'Subtotal must be greater than 0' }]
        }
      });
      return;
    }

    // Validate subsidies don't exceed subtotal
    const totalSubsidy = newStateSubsidy + newCentralSubsidy;
    if (totalSubsidy > newSubtotal) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Total subsidy cannot exceed subtotal',
          details: [{ field: 'subsidy', message: `Total subsidy (${totalSubsidy}) cannot exceed subtotal (${newSubtotal})` }]
        }
      });
      return;
    }

    // Prefer stored amountAfterSubsidy when only discount/finalAmount are patched (Final Settlement).
    const amountAfterSubsidy = resolveAmountAfterSubsidy(
      quotation as any,
      { centralSubsidy: newCentralSubsidy, stateSubsidy: newStateSubsidy },
      subtotal !== undefined || stateSubsidy !== undefined || centralSubsidy !== undefined
        ? newSubtotal
        : undefined
    );
    // Persist explicit discountAmount (INR); do not overwrite from %
    const effectiveDiscountAmount = newDiscountAmount !== undefined
      ? newDiscountAmount
      : (amountAfterSubsidy * (newDiscount <= 100 ? newDiscount : 0)) / 100;
    const calculatedTotalAmount = Math.max(0, amountAfterSubsidy - effectiveDiscountAmount);
    const calculatedFinalAmount = calculatedTotalAmount;
    // Prefer client finalAmount when provided (Final Settlement sends effective payable)
    const finalFinalAmount = newFinalAmount !== undefined ? newFinalAmount : calculatedFinalAmount;
    const bodyTotalAmount = req.body.totalAmount !== undefined ? toFiniteNumber(req.body.totalAmount) : undefined;
    const persistedTotalAmount =
      bodyTotalAmount !== undefined ? Number(bodyTotalAmount) : calculatedTotalAmount;

    // Validate finalAmount against stored/computed amountAfterSubsidy
    if (
      newFinalAmount !== undefined &&
      (isNaN(newFinalAmount) || newFinalAmount < 0 || newFinalAmount > amountAfterSubsidy + 0.01)
    ) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Final amount must be between 0 and amount after subsidy',
          details: [{ field: 'finalAmount', message: `Final amount must be between 0 and ${amountAfterSubsidy}` }]
        }
      });
      return;
    }

    const normalizedPaidAmount = paidAmount !== undefined && paidAmount !== null
      ? Number(toFiniteNumber(paidAmount))
      : undefined;
    const paidForRemaining =
      normalizedPaidAmount !== undefined
        ? normalizedPaidAmount
        : Number(quotation.paidAmount || 0);
    const computedRemaining = remainingPaymentAgainstSubtotal(
      amountAfterSubsidy,
      paidForRemaining,
      effectiveDiscountAmount
    );
    const normalizedPaymentStatus = normalizedPaidAmount !== undefined
      ? calculatePaymentStatus(normalizedPaidAmount, persistedTotalAmount)
      : (paymentStatus ?? undefined);

    // When absolute discountAmount is set, store it on `discount` too (FE: discount > 100 ⇒ INR).
    const discountFieldToStore =
      newDiscountAmount !== undefined
        ? effectiveDiscountAmount
        : newDiscount;

    // Update quotation
    await quotation.update({
      subtotal: newSubtotal,
      discount: discountFieldToStore,
      totalAmount: persistedTotalAmount,
      finalAmount: finalFinalAmount,
      discountAmount: effectiveDiscountAmount,
      remainingAmount: computedRemaining,
      paymentMode: paymentMode !== undefined ? paymentMode : quotation.paymentMode,
      paidAmount: normalizedPaidAmount !== undefined ? normalizedPaidAmount : quotation.paidAmount,
      paymentDate: paymentDate !== undefined ? paymentDate : quotation.paymentDate,
      paymentStatus: normalizedPaymentStatus !== undefined ? normalizedPaymentStatus : quotation.paymentStatus,
      validUntil: computeQuotationValidUntil(new Date())
    });

    // Update products with subsidies and/or the commercial flag if provided
    const commercialFlagProvided = commercialFlagDefinedInBody(req.body);
    if (stateSubsidy !== undefined || centralSubsidy !== undefined || commercialFlagProvided) {
      let quotationProduct = quotationAny.products || await QuotationProduct.findOne({ 
        where: { quotationId: quotation.id } 
      });

      const commercialPersistFields = commercialFlagProvided
        ? { pdfCommercialSet: isCommercial }
        : {};

      if (!quotationProduct) {
        // Get systemType and pricing from quotation
        quotationProduct = await QuotationProduct.create({
          id: uuidv4(),
          quotationId: quotation.id,
          systemType: quotation.systemType,
          subtotal: Number(quotation.subtotal || 0),
          totalAmount: Number(quotation.totalAmount || 0),
          stateSubsidy: newStateSubsidy,
          centralSubsidy: newCentralSubsidy,
          ...commercialPersistFields
        });
      } else {
        await quotationProduct.update({
          stateSubsidy: newStateSubsidy,
          centralSubsidy: newCentralSubsidy,
          ...commercialPersistFields
        });
      }
    }

    // Refresh quotation to get updated timestamp
    await quotation.reload();

    res.json({
      success: true,
      data: {
        id: quotation.id,
        paymentMode: quotation.paymentMode,
        paidAmount: quotation.paidAmount ? Number(quotation.paidAmount) : null,
        paymentDate: quotation.paymentDate,
        paymentStatus: quotation.paymentStatus,
        pricing: {
          subtotal: newSubtotal,
          totalSubsidy: totalSubsidy,
          stateSubsidy: newStateSubsidy,
          centralSubsidy: newCentralSubsidy,
          amountAfterSubsidy: amountAfterSubsidy,
          discount: discountFieldToStore,
          discountAmount: effectiveDiscountAmount,
          totalAmount: persistedTotalAmount,
          finalAmount: finalFinalAmount
        },
        discount: discountFieldToStore,
        discountAmount: effectiveDiscountAmount,
        discount_amount: effectiveDiscountAmount,
        subtotal: newSubtotal,
        totalAmount: persistedTotalAmount,
        finalAmount: finalFinalAmount,
        remaining: computedRemaining,
        remainingAmount: computedRemaining,
        ...quotationProposalDateApiFields(quotation)
      }
    });
  } catch (error) {
    logError('Update quotation pricing error', error, { quotationId: req.params.quotationId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const updateQuotationPaymentDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    const { quotationId } = req.params;
    const {
      paymentMode,
      paymentType: paymentTypeBody,
      paymentStatus: paymentStatusFromBody,
      subsidyCheques,
      remaining: remainingFromBody,
      remainingAmount: remainingAmountFromBody,
      finalSettlementAmount,
      finalSettlementApplied
    } = req.body as {
      paymentType?: 'loan' | 'cash' | 'mix';
      paymentMode?: 'cash' | 'upi' | 'loan' | 'netbanking' | 'bank_transfer' | 'cheque' | 'card' | 'mix';
      paymentStatus?: 'pending' | 'partial' | 'completed';
      phases?: any[];
      installments?: any[];
      paymentPhases?: any[];
      remaining?: number;
      remainingAmount?: number;
      finalSettlementAmount?: number;
      finalSettlementApplied?: boolean;
      subsidyCheques?: Array<{
        id: string;
        details: string;
        amount: number;
        status: 'pending' | 'cleared';
        clearedAt?: string;
      }>;
    };
    const paymentType =
      paymentTypeBody ||
      (paymentMode && ['loan', 'cash', 'mix'].includes(paymentMode) ? (paymentMode as 'loan' | 'cash' | 'mix') : undefined);
    const phasePayload = req.body.phases ?? req.body.installments ?? req.body.paymentPhases;
    // Only rewrite phases when the client explicitly sent a phase array (Final Settlement does not).
    const hasPhasePayload = Array.isArray(phasePayload);

    const role = req.user?.role;
    const isAccountManager = role === 'account-management';
    const isInventoryAdmin = role === 'admin';
    const isQuotationAdmin = req.dealer && req.dealer.role === 'admin';

    if (!isAccountManager && !isInventoryAdmin && !isQuotationAdmin) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const where: any = { id: quotationId, status: 'approved' };

    const quotation = await Quotation.findOne({ where });
    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    // Loan-only cannot apply Final Settlement (cash / mix only) — even via payment-details flag.
    if (finalSettlementApplied === true && rejectLoanOnlyFinalSettlement(quotation, res)) {
      return;
    }

    const { actorId } = resolveActorForAudit(req);
    const siteCostParsed = parseSiteCostFromBody(req.body as Record<string, unknown>);
    const siteCostFields =
      siteCostParsed !== undefined ? { siteCost: siteCostParsed } : {};
    const settlementFields = {
      ...(finalSettlementAmount !== undefined
        ? { finalSettlementAmount: Number(finalSettlementAmount) }
        : {}),
      ...(finalSettlementApplied !== undefined
        ? {
            finalSettlementApplied: !!finalSettlementApplied,
            ...(finalSettlementApplied
              ? { finalSettlementAt: new Date(), finalSettlementBy: actorId }
              : {})
          }
        : {})
    };

    if (hasPhasePayload) {
      const normalizedPhases = normalizePaymentPhases(phasePayload, actorId);
      // Optional §28: reject phase paymentMode not allowed for quotation paymentType
      const qPaymentType =
        paymentType ||
        normalizePaymentType((quotation as any).paymentType) ||
        normalizePaymentType((quotation as any).paymentMode);
      if (qPaymentType) {
        for (const ph of normalizedPhases) {
          if (!ph.paymentMode) continue;
          if (!isPhaseModeAllowedForPaymentType(qPaymentType, ph.paymentMode)) {
            res.status(400).json({
              success: false,
              error: {
                code: 'VAL_PHASE_MODE',
                message: `paymentMode "${ph.paymentMode}" not allowed for paymentType "${qPaymentType}" (phase ${ph.phaseNumber})`
              }
            });
            return;
          }
        }
      }
      const replacePhases = shouldReplacePaymentPhases(req, true);
      if (replacePhases) {
        await replaceQuotationPaymentPhases(quotation.id, normalizedPhases, actorId);
      } else {
        await upsertQuotationPaymentPhases(quotation.id, normalizedPhases, actorId);
      }

      const mergedPhases = await loadQuotationPaymentPhases(quotation.id);
      const totalPaidAmount = sumPhasePaidAmounts(mergedPhases);
      const plainQ = quotation.get({ plain: true }) as unknown as Record<string, unknown>;
      const discountAmt = Number((quotation as any).discountAmount || 0);
      // §31: AM installment cap = subtotal − discount (not amountAfterSubsidy − discount)
      const paymentCap = pickAmInstallmentPaymentCap(plainQ);
      const amGross = pickQuotationSubtotalForPayments(plainQ);
      if (totalPaidAmount > paymentCap + 0.01) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_012',
            message: `Total paid (${totalPaidAmount}) cannot exceed subtotal (${paymentCap})`
          }
        });
        return;
      }
      const reconciled = reconcilePaymentRemainingStatus(
        paymentStatusFromBody ?? quotation.paymentStatus,
        amGross || paymentCap,
        totalPaidAmount,
        discountAmt
      );
      if (paymentStatusFromBody === 'completed' && reconciled.remaining > 0.01) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_013',
            message:
              `Cannot mark payment completed while unpaid remaining (${reconciled.remaining}) exists. Apply remaining as discountAmount via PATCH /pricing first.`
          }
        });
        return;
      }
      const remainingStored =
        paymentStatusFromBody === 'completed' && reconciled.remaining <= 0.01
          ? 0
          : reconciled.remaining;
      const resolvedPaymentStatus =
        paymentStatusFromBody === 'completed' && reconciled.remaining <= 0.01
          ? 'completed'
          : paymentStatusFromBody !== undefined && paymentStatusFromBody !== null && reconciled.remaining <= 0.01
            ? paymentStatusFromBody
            : reconciled.paymentStatus;

      const latestPaymentDate = mergedPhases
        .map((phase) => phase.paymentDate)
        .filter((value): value is string => !!value)
        .sort()
        .pop() || null;

      await quotation.update({
        paymentMode: paymentMode !== undefined ? paymentMode : quotation.paymentMode,
        paymentType: paymentType !== undefined ? paymentType : (quotation as any).paymentType,
        paymentStatus: resolvedPaymentStatus,
        paidAmount: totalPaidAmount,
        paymentDate: latestPaymentDate ? new Date(latestPaymentDate) : quotation.paymentDate,
        paymentPhases: mergedPhases,
        remainingAmount: remainingStored,
        ...siteCostFields,
        ...settlementFields,
        ...(subsidyCheques !== undefined ? { subsidyCheques } : {}),
        paymentPlanUpdatedBy: actorId,
        paymentPlanUpdatedAt: new Date()
      });
    } else if (finalSettlementApplied === true) {
      // Flag-only Final Settlement (fallback attempt): persist the write-off itself so this
      // call alone settles even if PATCH /pricing never ran. Do NOT touch installments; skip
      // VAL_012; never reject with "cannot exceed remaining". Grow discount only up to
      // amountAfterSubsidy − paid so payable never drops below paid (subtotal-vs-AAS mismatch).
      // (Loan-only already rejected above when finalSettlementApplied === true.)
      const existingDiscount = Number((quotation as any).discountAmount || 0);
      const amountAfterSubsidyCap = resolveAmountAfterSubsidy(quotation as any);
      const paidAmt = Number(quotation.paidAmount || 0);
      const discountToClear = Math.max(
        0,
        amountAfterSubsidyCap - Math.min(paidAmt, amountAfterSubsidyCap)
      );
      const newDiscount = Math.min(
        amountAfterSubsidyCap,
        Math.max(existingDiscount, discountToClear)
      );
      const newFinalAmount = Math.max(0, amountAfterSubsidyCap - newDiscount);
      // Audit: record what AM asked to write off (may exceed applied discount in mismatch case).
      const auditSettlement =
        finalSettlementAmount !== undefined
          ? Number(finalSettlementAmount)
          : Math.max(0, amountAfterSubsidyCap - existingDiscount - paidAmt);

      await quotation.update({
        paymentMode: paymentMode !== undefined ? paymentMode : quotation.paymentMode,
        paymentType: paymentType !== undefined ? paymentType : (quotation as any).paymentType,
        discount: newDiscount,
        discountAmount: newDiscount,
        totalAmount: newFinalAmount,
        finalAmount: newFinalAmount,
        remainingAmount: 0,
        paymentStatus: 'completed',
        finalSettlementApplied: true,
        finalSettlementAmount: auditSettlement,
        finalSettlementAt: new Date(),
        finalSettlementBy: actorId,
        ...siteCostFields,
        ...(subsidyCheques !== undefined ? { subsidyCheques } : {}),
        paymentPlanUpdatedBy: actorId,
        paymentPlanUpdatedAt: new Date()
      });
    } else {
      // Status-only / site-cost-only update — do not touch installments; skip VAL_012.
      const discountAmt = Number((quotation as any).discountAmount || 0);
      const amountAfterSubsidyCap = resolveAmountAfterSubsidy(quotation as any);
      const paidAmt = Number(quotation.paidAmount || 0);
      const reconciled = reconcilePaymentRemainingStatus(
        paymentStatusFromBody ?? quotation.paymentStatus,
        amountAfterSubsidyCap,
        paidAmt,
        discountAmt
      );

      // Guard: don't fake completion when an unpaid gap exists and no settlement flag was sent.
      if (paymentStatusFromBody === 'completed' && reconciled.remaining > 0.01) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_013',
            message:
              `Cannot mark payment completed while unpaid remaining (${reconciled.remaining}) exists. Apply remaining as discountAmount via PATCH /pricing first, or send finalSettlementApplied: true.`
          }
        });
        return;
      }

      const bodyRemaining =
        remainingFromBody !== undefined
          ? Number(remainingFromBody)
          : remainingAmountFromBody !== undefined
            ? Number(remainingAmountFromBody)
            : undefined;

      const remainingStored =
        paymentStatusFromBody === 'completed' || (bodyRemaining !== undefined && bodyRemaining <= 0.01)
          ? 0
          : bodyRemaining !== undefined
            ? Math.max(0, bodyRemaining)
            : reconciled.remaining;

      const resolvedPaymentStatus =
        paymentStatusFromBody === 'completed' && remainingStored <= 0.01
          ? 'completed'
          : paymentStatusFromBody !== undefined
            ? paymentStatusFromBody
            : reconciled.paymentStatus;

      await quotation.update({
        paymentMode: paymentMode !== undefined ? paymentMode : quotation.paymentMode,
        paymentType: paymentType !== undefined ? paymentType : (quotation as any).paymentType,
        ...(paymentStatusFromBody !== undefined || bodyRemaining !== undefined
          ? { paymentStatus: resolvedPaymentStatus, remainingAmount: remainingStored }
          : {}),
        ...siteCostFields,
        ...settlementFields,
        ...(subsidyCheques !== undefined ? { subsidyCheques } : {}),
        paymentPlanUpdatedBy: actorId,
        paymentPlanUpdatedAt: new Date()
      });
    }

    await quotation.reload();
    const responsePhases = await loadQuotationPaymentPhases(quotation.id);
    const totalPaidSaved =
      quotation.paidAmount != null
        ? Number(quotation.paidAmount)
        : sumPhasePaidAmounts(responsePhases);
    const amountAfterSubsidyOut = resolveAmountAfterSubsidy(quotation as any);
    const discountAmtOut = Number((quotation as any).discountAmount || 0);
    const reconciledOut = reconcilePaymentRemainingStatus(
      quotation.paymentStatus,
      amountAfterSubsidyOut,
      totalPaidSaved,
      discountAmtOut
    );
    const qAny = quotation as any;
    const subsidyChequesOut = Array.isArray(qAny.subsidyCheques) ? qAny.subsidyCheques : [];
    const rowPlain = quotation.get({ plain: true }) as unknown as Record<string, unknown>;

    res.json({
      success: true,
      data: {
        id: quotation.id,
        quotationId: quotation.id,
        ...quotationPaymentApiFields(rowPlain),
        ...quotationAdminMetadataFields(rowPlain),
        ...quotationAmountApiFields(rowPlain),
        paymentStatus: reconciledOut.paymentStatus,
        subtotal: Number(quotation.subtotal || 0),
        discountAmount: discountAmtOut,
        discount_amount: discountAmtOut,
        paidAmount: totalPaidSaved,
        remaining: reconciledOut.remaining,
        remainingAmount: reconciledOut.remaining,
        finalSettlementAmount:
          qAny.finalSettlementAmount != null ? Number(qAny.finalSettlementAmount) : null,
        finalSettlementApplied: !!qAny.finalSettlementApplied,
        finalSettlementAt: qAny.finalSettlementAt || null,
        subsidyCheques: subsidyChequesOut,
        subsidy_cheques: subsidyChequesOut,
        installments: responsePhases,
        paymentPhases: responsePhases,
        payment_phases: responsePhases,
        paymentPlanUpdatedBy: (quotation as any).paymentPlanUpdatedBy || null,
        paymentPlanUpdatedAt: (quotation as any).paymentPlanUpdatedAt || null,
        updatedAt: quotation.updatedAt
      }
    });
  } catch (error) {
    logError('Update quotation payment details error', error, { quotationId: req.params.quotationId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

/**
 * Optional one-shot Final Settlement: write off remaining as discountAmount, mark completed.
 * Prefer FE sequence (PATCH pricing → status-only payment-details); this is a convenience.
 */
export const submitQuotationFinalSettlement = async (req: Request, res: Response): Promise<void> => {
  try {
    const role = req.user?.role;
    const isAccountManager = role === 'account-management' || role === 'hr';
    const isInventoryAdmin =
      role === 'admin' || role === 'super-admin' || role === 'super-admin-manager';
    const isQuotationAdmin = req.dealer && req.dealer.role === 'admin';
    if (!isAccountManager && !isInventoryAdmin && !isQuotationAdmin) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const { quotationId } = req.params;
    // Client sends amount / settlementAmount / discountAmount (all = remaining); accept any.
    const amountRaw =
      req.body?.amount ??
      req.body?.settlementAmount ??
      req.body?.discountAmount ??
      req.body?.finalSettlementAmount;
    const amount = amountRaw !== undefined && amountRaw !== null ? Number(amountRaw) : NaN;
    if (!Number.isFinite(amount) || amount < 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'amount must be a non-negative number (settlement = remaining only)'
        }
      });
      return;
    }

    const quotation = await Quotation.findOne({
      where: { id: quotationId, status: 'approved' },
      include: [{ model: QuotationProduct, as: 'products' }]
    });
    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    const phases = await loadQuotationPaymentPhases(quotation.id);

    // Idempotent: if already settled, echo current state instead of double-adding discount.
    if ((quotation as any).finalSettlementApplied === true) {
      const qAny = quotation as any;
      res.json({
        success: true,
        data: {
          id: quotation.id,
          discountAmount: Number(qAny.discountAmount || 0),
          discount_amount: Number(qAny.discountAmount || 0),
          remaining: 0,
          remainingAmount: 0,
          paymentStatus: 'completed',
          finalSettlementAmount:
            qAny.finalSettlementAmount != null ? Number(qAny.finalSettlementAmount) : null,
          finalSettlementApplied: true,
          finalSettlementAt: qAny.finalSettlementAt || null,
          finalSettlementBy: qAny.finalSettlementBy || null,
          installments: phases,
          paymentPhases: phases
        }
      });
      return;
    }

    // Optional server guard: Final Settlement only for Cash / Cash + loan (mix).
    if (rejectLoanOnlyFinalSettlement(quotation, res)) return;

    const paid =
      phases.length > 0
        ? sumPhasePaidAmounts(phases)
        : Number(quotation.paidAmount || 0);
    const amountAfterSubsidy = resolveAmountAfterSubsidy(
      quotation as any,
      (quotation as any).products
    );
    const existingDiscount = Number((quotation as any).discountAmount || 0);
    const currentRemaining = remainingPaymentAgainstSubtotal(
      amountAfterSubsidy,
      paid,
      existingDiscount
    );

    // Settlement = "mark completed, remaining 0". Do NOT reject when the server already
    // thinks the balance is cleared (subtotal-vs-amountAfterSubsidy mismatch: AM may show a
    // small gap the server's amountAfterSubsidy doesn't). Store the requested amount for audit,
    // but only grow discount up to (amountAfterSubsidy − paid) so payable never drops below paid.
    const requestedSettlement = amount > 0 ? amount : currentRemaining;
    const maxDiscountAddable = Math.max(0, currentRemaining); // = amountAfterSubsidy − paid − existingDiscount, floored at 0
    const discountAdded = Math.min(requestedSettlement, maxDiscountAddable);
    const newDiscountAmount = existingDiscount + discountAdded;
    const newTotalAmount = Math.max(0, amountAfterSubsidy - newDiscountAmount);
    const { actorId } = resolveActorForAudit(req);

    await quotation.update({
      discountAmount: newDiscountAmount,
      discount: newDiscountAmount,
      totalAmount: newTotalAmount,
      finalAmount: newTotalAmount,
      remainingAmount: 0,
      paymentStatus: 'completed',
      // Audit: record what AM asked to write off, even if the server could only apply `discountAdded`.
      finalSettlementAmount: requestedSettlement,
      finalSettlementApplied: true,
      finalSettlementAt: new Date(),
      finalSettlementBy: actorId,
      paymentPlanUpdatedBy: actorId,
      paymentPlanUpdatedAt: new Date(),
      validUntil: computeQuotationValidUntil(new Date())
    });

    await quotation.reload();
    const responsePhases = await loadQuotationPaymentPhases(quotation.id);
    const qAny = quotation as any;

    res.json({
      success: true,
      data: {
        id: quotation.id,
        discountAmount: Number(qAny.discountAmount || 0),
        discount_amount: Number(qAny.discountAmount || 0),
        remaining: 0,
        remainingAmount: 0,
        paymentStatus: 'completed',
        finalSettlementAmount: Number(qAny.finalSettlementAmount || requestedSettlement),
        finalSettlementApplied: true,
        finalSettlementAt: qAny.finalSettlementAt || null,
        finalSettlementBy: qAny.finalSettlementBy || null,
        installments: responsePhases,
        paymentPhases: responsePhases
      }
    });
  } catch (error) {
    logError('Submit final settlement error', error, { quotationId: req.params.quotationId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

/**
 * Revert final settlement.
 * Clears settlement audit fields and recomputes discount/finalAmount/remaining/paymentStatus
 * while keeping installment/phases rows unchanged.
 */
export const revertQuotationFinalSettlement = async (req: Request, res: Response): Promise<void> => {
  try {
    const role = req.user?.role;
    const isAccountManager = role === 'account-management' || role === 'hr';
    const isInventoryAdmin =
      role === 'admin' || role === 'super-admin' || role === 'super-admin-manager';
    const isQuotationAdmin = req.dealer && req.dealer.role === 'admin';
    if (!isAccountManager && !isInventoryAdmin && !isQuotationAdmin) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const { quotationId } = req.params;
    const quotation = await Quotation.findOne({
      where: { id: quotationId, status: 'approved' },
      include: [{ model: QuotationProduct, as: 'products' }]
    });
    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    const phases = await loadQuotationPaymentPhases(quotation.id);
    const paid =
      phases.length > 0
        ? sumPhasePaidAmounts(phases)
        : Number((quotation as any).paidAmount || 0);

    const amountAfterSubsidy = resolveAmountAfterSubsidy(
      quotation as any,
      (quotation as any).products
    );

    const settlementAmount = Number((quotation as any).finalSettlementAmount || 0);
    const currentDiscountAmount = Number((quotation as any).discountAmount || 0);

    // Required discount (server-side) to clear remaining based on amountAfterSubsidy and paid.
    const discountToClear = Math.max(
      0,
      amountAfterSubsidy - Math.min(paid, amountAfterSubsidy)
    );

    // Revert discount:
    // - If current discount is already higher than what's required to clear the balance,
    //   assume settlement did not change discount; keep it.
    // - Otherwise, derive the "pre-settlement" discount using AM audit settlementAmount
    //   and the AM-visible cap (quotation.subtotal).
    let newDiscountAmount = currentDiscountAmount;
    if (settlementAmount > 0) {
      const likelyDiscountWasTouched = currentDiscountAmount <= discountToClear + 0.01;
      if (likelyDiscountWasTouched) {
        const amCap = Number(quotation.subtotal || 0) || amountAfterSubsidy;
        const derivedPreDiscount = amCap - paid - settlementAmount;
        if (Number.isFinite(derivedPreDiscount)) {
          newDiscountAmount = Math.max(
            0,
            Math.min(currentDiscountAmount, derivedPreDiscount)
          );
        }
      }
    }

    newDiscountAmount = Math.max(0, Math.min(newDiscountAmount, amountAfterSubsidy));
    const finalAmount = Math.max(0, amountAfterSubsidy - newDiscountAmount);
    const remainingAmount = remainingPaymentAgainstSubtotal(
      amountAfterSubsidy,
      paid,
      newDiscountAmount
    );

    const epsilon = 0.01;
    const paymentStatus =
      remainingAmount > epsilon
        ? paid > epsilon
          ? 'partial'
          : 'pending'
        : paid > epsilon || newDiscountAmount > epsilon
          ? 'completed'
          : 'pending';

    const { actorId } = resolveActorForAudit(req);
    await quotation.update({
      discountAmount: newDiscountAmount,
      discount: newDiscountAmount,
      totalAmount: finalAmount,
      finalAmount: finalAmount,
      amountAfterSubsidy: amountAfterSubsidy,
      remainingAmount,
      paymentStatus,

      // Clear settlement audit fields
      finalSettlementApplied: false,
      finalSettlementAmount: 0,
      finalSettlementAt: null,
      finalSettlementBy: null,

      paymentPlanUpdatedBy: actorId,
      paymentPlanUpdatedAt: new Date()
    });

    await quotation.reload();
    const responsePhases = await loadQuotationPaymentPhases(quotation.id);
    const qAny = quotation as any;

    res.json({
      success: true,
      data: {
        id: quotation.id,
        quotationId: quotation.id,
        discountAmount: Number(qAny.discountAmount || 0),
        discount_amount: Number(qAny.discountAmount || 0),
        remaining: remainingAmount,
        remainingAmount: remainingAmount,
        paymentStatus,
        finalSettlementAmount: 0,
        finalSettlementApplied: false,
        finalSettlementAt: null,
        finalSettlementBy: null,
        installments: responsePhases,
        paymentPhases: responsePhases
      }
    });
  } catch (error) {
    logError('Revert final settlement error', error, { quotationId: req.params.quotationId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const updateQuotationInstallationScheduledAt = async (req: Request, res: Response): Promise<void> => {
  try {
    const { quotationId } = req.params;
    const { installationScheduledAt } = req.body as { installationScheduledAt: string | null };

    const quotation = await Quotation.findByPk(quotationId);
    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    await quotation.update({
      installationScheduledAt
    });

    const rowPlain = quotation.get({ plain: true }) as unknown as Record<string, unknown>;
    res.json({
      success: true,
      data: {
        id: quotation.id,
        quotationId: quotation.id,
        ...quotationAdminMetadataFields(rowPlain),
        updatedAt: quotation.updatedAt
      }
    });
  } catch (error) {
    logError('Update quotation installation scheduled date error', error, { quotationId: req.params.quotationId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const updateQuotationInstallationRelease = async (req: Request, res: Response): Promise<void> => {
  try {
    const { quotationId } = req.params;
    const body = req.body as {
      installationReadyForInstaller?: boolean;
      installation_ready_for_installer?: boolean;
      installationReleasedAt?: string | null;
      installation_released_at?: string | null;
    };

    const installationReadyForInstaller =
      body.installationReadyForInstaller ?? body.installation_ready_for_installer;
    const installationReleasedAt = body.installationReleasedAt ?? body.installation_released_at;

    if (typeof installationReadyForInstaller !== 'boolean') {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'installationReadyForInstaller (or installation_ready_for_installer) must be boolean'
        }
      });
      return;
    }

    // Account-management/admin only; dealer-admin JWT kept for backward compatibility.
    const role = req.user?.role;
    const isAccountManager = role === 'account-management';
    const isInventoryAdmin =
      role === 'admin' || role === 'super-admin' || role === 'super-admin-manager';
    const isQuotationAdmin = req.dealer && req.dealer.role === 'admin';
    if (!isAccountManager && !isInventoryAdmin && !isQuotationAdmin) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const quotation = await Quotation.findByPk(quotationId);
    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    const releaseTimestamp =
      installationReadyForInstaller === true
        ? (installationReleasedAt ? new Date(installationReleasedAt) : new Date())
        : null;

    const existingHistory = Array.isArray((quotation as any).statusHistory)
      ? ([...(quotation as any).statusHistory] as Array<{ status: string; at: string; actorRole?: string | null; actorId?: string | null }>)
      : [];
    existingHistory.push({
      status: installationReadyForInstaller ? 'installation_released' : 'installation_release_revoked',
      at: new Date().toISOString(),
      actorRole: role || req.dealer?.role || null,
      actorId: req.user?.id || req.dealer?.id || null
    });

    await quotation.update({
      installationReadyForInstaller,
      installationReleasedAt: releaseTimestamp,
      installationStatus: installationReadyForInstaller ? 'pending_installer' : quotation.installationStatus,
      statusHistory: existingHistory
    });
    await quotation.reload();

    const rowPlain = quotation.get({ plain: true }) as unknown as Record<string, unknown>;
    res.json({
      success: true,
      data: {
        id: quotation.id,
        quotationId: quotation.id,
        ...serializeInstallationReleaseFields(rowPlain),
        ...quotationAdminMetadataFields(rowPlain),
        updatedAt: quotation.updatedAt
      }
    });
  } catch (error) {
    logError('Update quotation installation release error', error, { quotationId: req.params.quotationId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

const normalizeAwsEnvValue = (value: string | undefined, fallback = ''): string => {
  const normalized = String(value || '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '');

  if (!normalized) return fallback;

  const lower = normalized.toLowerCase();
  if (lower === 'undefined' || lower === 'null') {
    return fallback;
  }

  return normalized;
};

const getS3Client = () => {
  const region = normalizeAwsEnvValue(process.env.AWS_REGION, 'ap-south-1');
  const accessKeyId = normalizeAwsEnvValue(process.env.AWS_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID);
  const secretAccessKey = normalizeAwsEnvValue(process.env.AWS_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY);

  if (accessKeyId && secretAccessKey) {
    return new AWS.S3({ region, accessKeyId, secretAccessKey });
  }
  return new AWS.S3({ region });
};

const buildS3Url = (key: string) => {
  const publicBase = process.env.AWS_S3_PUBLIC_URL;
  if (publicBase) {
    return `${publicBase.replace(/\/$/, '')}/${key}`;
  }
  const bucket = normalizeAwsEnvValue(process.env.AWS_BUCKET_NAME, 'cbpl-bajaj-node');
  const region = normalizeAwsEnvValue(process.env.AWS_REGION, 'ap-south-1');
  const host = region === 'us-east-1' ? 's3.amazonaws.com' : `s3.${region}.amazonaws.com`;
  return `https://${bucket}.${host}/${key}`;
};

const uploadFileToS3 = async (file: Express.Multer.File, quotationId: string, fieldName: string) => {
  const bucket = normalizeAwsEnvValue(process.env.AWS_BUCKET_NAME, 'cbpl-bajaj-node');
  if (!bucket) {
    throw new Error('AWS_BUCKET_NAME is not configured');
  }
  const ext = path.extname(file.originalname || '');
  const key = `quotation-documents/${quotationId}/${fieldName}-${Date.now()}${ext}`;

  const s3 = getS3Client();
  await s3
    .putObject({
      Bucket: bucket,
      Key: key,
      Body: file.buffer,
      ContentType: resolveImageContentTypeForUpload(file)
    })
    .promise();

  return buildS3Url(key);
};

const wrapQuotationDocumentUploadError = (fieldName: string, error: any): never => {
  const message = typeof error?.message === 'string' ? error.message : 'Upload failed';
  const code = typeof error?.code === 'string' ? error.code : undefined;
  const statusCode = code === 'AccessDenied' ? 403 : 502;
  const errorCode = code === 'AccessDenied' ? 'AUTH_004' : 'SYS_001';

  const wrapped: any = new Error(message);
  wrapped.statusCode = statusCode;
  wrapped.errorPayload = {
    success: false,
    error: {
      code: errorCode,
      message: `Failed to upload ${fieldName}. ${message}`,
      details: [
        { field: fieldName, message },
        ...(code ? [{ field: 's3Code', message: code }] : [])
      ]
    }
  };
  throw wrapped;
};

const uploadDocumentFieldFileSafe = async (
  file: Express.Multer.File,
  fieldName: string,
  quotationId: string
): Promise<string> => {
  try {
    return await uploadFileToS3(file, quotationId, fieldName);
  } catch (error: any) {
    return wrapQuotationDocumentUploadError(fieldName, error);
  }
};

const getUploadedFileUrlSafe = async (
  req: Request,
  fieldName: string,
  quotationId: string
): Promise<string | undefined> => {
  const files = (req as any).files;
  const fieldFiles = files?.[fieldName];
  if (!Array.isArray(fieldFiles) || fieldFiles.length === 0) {
    return undefined;
  }
  const file = fieldFiles[0] as Express.Multer.File;
  return uploadDocumentFieldFileSafe(file, fieldName, quotationId);
};

const extractS3KeyFromDocumentUrl = (value: string): string | null => {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('/uploads/') || trimmed.startsWith('uploads/')) {
    return null;
  }

  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return trimmed.startsWith('quotation-documents/') ? trimmed : null;
  }

  const publicBase = process.env.AWS_S3_PUBLIC_URL?.replace(/\/$/, '');
  if (publicBase && trimmed.startsWith(publicBase)) {
    const raw = trimmed.slice(publicBase.length + 1).split('?')[0];
    return decodeS3UrlPathToKey(raw) || raw || null;
  }

  try {
    const parsed = new URL(trimmed);
    const isS3Host = parsed.hostname.includes('amazonaws.com') || parsed.hostname.startsWith('s3.');
    if (!isS3Host) {
      return null;
    }
    return decodeS3UrlPathToKey(parsed.pathname) || null;
  } catch {
    return null;
  }
};

const normalizeStoredDocumentReference = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('blob:') || trimmed.startsWith('data:')) {
    return null;
  }
  const possibleKey = extractS3KeyFromDocumentUrl(trimmed);
  if (possibleKey) {
    return possibleKey;
  }
  return trimmed.length <= 255 ? trimmed : null;
};

const resolveDocumentImageUrl = async (value: string | null | undefined): Promise<string | null> => {
  if (!value) return null;

  const key = extractS3KeyFromDocumentUrl(value);
  if (!key) {
    return value;
  }

  try {
    return await generatePublicUrl(key, 24 * 60 * 60);
  } catch (error) {
    logError('Failed to generate signed URL for quotation document', error, { key });
    return value;
  }
};

const QUOTATION_DOCUMENT_MEDIA_FIELDS = [
  'aadharFront',
  'aadharBack',
  'panImage',
  'electricityBillImage',
  'bankPassbookImage',
  'geotagRoofPhoto',
  'customerWithHousePhoto',
  'propertyDocumentPdf',
  'compliantAadharFront',
  'compliantAadharBack',
  'compliantPanImage',
  'compliantBankPassbookImage',
  'customerFinalBillFile',
  'panelWarrantyFile',
  'inverterWarrantyFile',
  'workCompletionWarrantyFile'
] as const;

const buildEmptyResolvedQuotationDocuments = () => {
  const empty: Record<string, string | null> = {};
  for (const field of QUOTATION_DOCUMENT_MEDIA_FIELDS) {
    empty[field] = null;
  }
  return empty;
};

const QUOTATION_DOCUMENT_IMAGE_ONLY_FIELDS = new Set([
  'aadharFront',
  'aadharBack',
  'panImage',
  'bankPassbookImage',
  'geotagRoofPhoto',
  'customerWithHousePhoto',
  'compliantAadharFront',
  'compliantAadharBack',
  'compliantPanImage',
  'compliantBankPassbookImage'
]);

const QUOTATION_DOCUMENT_IMAGE_OR_PDF_FIELDS = new Set([
  'customerFinalBillFile',
  'panelWarrantyFile',
  'inverterWarrantyFile',
  'workCompletionWarrantyFile'
]);

const QUOTATION_DOCUMENT_PDF_ONLY_FIELDS = new Set(['propertyDocumentPdf', 'electricityBillImage']);

/**
 * §18 Document Submission — optional media (Jul 2026).
 * Never 400 solely because these are omitted or still null after save.
 * Keep allowlisted so uploads are accepted when present.
 */
export const OPTIONAL_QUOTATION_DOCUMENT_MEDIA_FIELDS = new Set([
  'propertyDocumentPdf',
  'geotagRoofPhoto',
  'customerWithHousePhoto'
]);

const ensureQuotationDocumentUploadFieldIsValid = (
  fieldName: string,
  file: Express.Multer.File
): { valid: true } | { valid: false; message: string } => {
  if (!(QUOTATION_DOCUMENT_MEDIA_FIELDS as readonly string[]).includes(fieldName)) {
    return { valid: false, message: 'Invalid document field' };
  }

  if (QUOTATION_DOCUMENT_IMAGE_ONLY_FIELDS.has(fieldName)) {
    return isAllowedStandardImageUpload(file)
      ? { valid: true }
      : { valid: false, message: standardImageValidationMessage(fieldName) };
  }
  if (QUOTATION_DOCUMENT_IMAGE_OR_PDF_FIELDS.has(fieldName)) {
    return isAllowedStandardImageOrPdfUpload(file)
      ? { valid: true }
      : { valid: false, message: standardImageOrPdfValidationMessage(fieldName) };
  }
  if (QUOTATION_DOCUMENT_PDF_ONLY_FIELDS.has(fieldName)) {
    return isAllowedPdfUpload(file)
      ? { valid: true }
      : { valid: false, message: pdfOnlyValidationMessage(fieldName) };
  }
  return file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf'
    ? { valid: true }
    : { valid: false, message: 'Only image or PDF uploads are allowed' };
};

const resolveQuotationDocumentUrls = async (documents: any) => {
  const json = documents
    ? (typeof documents.toJSON === 'function' ? documents.toJSON() : { ...documents })
    : buildEmptyResolvedQuotationDocuments();
  const mediaFields = [
    'aadharFront',
    'aadharBack',
    'panImage',
    'electricityBillImage',
    'bankPassbookImage',
    'geotagRoofPhoto',
    'customerWithHousePhoto',
    'propertyDocumentPdf',
    'compliantAadharFront',
    'compliantAadharBack',
    'compliantPanImage',
    'compliantBankPassbookImage',
    'customerFinalBillFile',
    'panelWarrantyFile',
    'inverterWarrantyFile',
    'workCompletionWarrantyFile'
  ];

  for (const field of mediaFields) {
    json[field] = await resolveDocumentImageUrl(json[field]);
  }

  // Always expose consistent alias keys for frontend compatibility.
  for (const field of mediaFields) {
    const value = json[field] ?? null;
    const urlKey = `${field}Url`;
    const nameKey = `${field}Name`;
    const snakeField = field.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
    const snakeUrlKey = `${snakeField}_url`;
    const snakeNameKey = `${snakeField}_name`;
    const resolvedName =
      typeof value === 'string' && value.trim()
        ? (() => {
            const clean = value.split('?')[0];
            const base = clean.split('/').pop() || null;
            return base || null;
          })()
        : null;
    json[urlKey] = value;
    json[snakeUrlKey] = value;
    json[nameKey] = resolvedName;
    json[snakeNameKey] = resolvedName;
  }

  return json;
};

const isOperationalDocumentsEditorRole = (role: string | undefined): boolean =>
  role === 'baldev' ||
  role === 'confirmation' ||
  role === 'admin' ||
  role === 'super-admin' ||
  role === 'super-admin-manager';

const requestHasUploadedFinalConfirmationFiles = (req: Request): boolean => {
  const files = (req as any).files;
  if (!files || typeof files !== 'object') return false;
  return FINAL_CONFIRMATION_DOCUMENT_FIELDS.some((field) => {
    const part = files[field];
    return Array.isArray(part) && part.length > 0;
  });
};

/** PATCH KYC route used with only final-confirmation file parts — skip phone/email/kno checks (§M). */
const requestIsFinalConfirmationOnlyUpload = (req: Request): boolean => {
  if (!requestHasUploadedFinalConfirmationFiles(req)) return false;
  const files = (req as any).files || {};
  const uploadedKeys = Object.keys(files).filter(
    (key) => Array.isArray(files[key]) && (files[key] as unknown[]).length > 0
  );
  if (!uploadedKeys.every((key) => isFinalConfirmationDocumentField(key))) return false;

  const body: Record<string, unknown> = req.body || {};
  const kycTextFields = [
    'phoneNumber',
    'emailId',
    'electricityKno',
    'aadharNumber',
    'panNumber',
    'bankAccountNumber',
    'bankIfsc',
    'compliantContactPhone'
  ];
  const hasKycText = kycTextFields.some((field) => {
    const value = body[field];
    return value !== undefined && value !== null && String(value).trim() !== '';
  });
  return !hasKycText;
};

const buildFinalConfirmationResponseExtras = async (
  resolved: Record<string, unknown>
): Promise<Record<string, string | null>> => buildFinalConfirmationApiFields(resolved);

const upsertFinalConfirmationDocumentFields = async (
  quotationId: string,
  fieldUpdates: Partial<Record<(typeof FINAL_CONFIRMATION_DOCUMENT_FIELDS)[number], string | null>>,
  existing: QuotationDocument | null
): Promise<QuotationDocument> => {
  if (existing) {
    for (const [field, newValue] of Object.entries(fieldUpdates)) {
      const oldValue = (existing as any)[field];
      if (newValue && oldValue && newValue !== oldValue) {
        await deleteFileFromS3IfExists(oldValue);
      }
    }
    return existing.update(fieldUpdates);
  }

  return QuotationDocument.create({
    id: uuidv4(),
    quotationId,
    isCompliantSenior: false,
    ...fieldUpdates
  });
};

/** POST …/final-confirmation-documents — admin / baldev partial uploads (§M). */
export const saveFinalConfirmationDocuments = async (req: Request, res: Response): Promise<void> => {
  try {
    const role = req.user?.role || req.dealer?.role;
    if (!isOperationalDocumentsEditorRole(role)) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }

    const { quotationId } = req.params;
    const quotation = await Quotation.findByPk(quotationId);
    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    const body: Record<string, unknown> = req.body || {};
    const existing = await QuotationDocument.findOne({ where: { quotationId: quotation.id } });
    const fieldUpdates: Partial<
      Record<(typeof FINAL_CONFIRMATION_DOCUMENT_FIELDS)[number], string | null>
    > = {};
    let anyInput = false;

    for (const field of FINAL_CONFIRMATION_DOCUMENT_FIELDS) {
      const uploadedUrl = await getUploadedFileUrlSafe(req, field, quotation.id);
      if (uploadedUrl !== undefined) {
        const files = (req as any).files?.[field];
        const file = Array.isArray(files) ? (files[0] as Express.Multer.File) : undefined;
        if (file) {
          const fieldValidation = ensureQuotationDocumentUploadFieldIsValid(field, file);
          if (!fieldValidation.valid) {
            res.status(400).json({
              success: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: fieldValidation.message,
                details: [{ field, message: fieldValidation.message }]
              }
            });
            return;
          }
        }
        anyInput = true;
        fieldUpdates[field] = normalizeStoredDocumentReference(uploadedUrl) || uploadedUrl;
        continue;
      }

      const snakeField = field.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
      const bodyValue = body[field] ?? body[`${field}Url`] ?? body[snakeField] ?? body[`${snakeField}_url`];
      if (bodyValue !== undefined) {
        anyInput = true;
        if (bodyValue === '' || bodyValue === null) {
          fieldUpdates[field] = null;
        } else {
          fieldUpdates[field] =
            normalizeStoredDocumentReference(String(bodyValue)) || ((existing as any)?.[field] ?? null);
        }
      }
    }

    if (!anyInput) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'At least one final confirmation document is required',
          details: [{
            field: 'files',
            message:
              'Upload one or more of: customerFinalBillFile, panelWarrantyFile, inverterWarrantyFile, workCompletionWarrantyFile'
          }]
        }
      });
      return;
    }

    const documents = await upsertFinalConfirmationDocumentFields(quotation.id, fieldUpdates, existing);
    const resolvedSavedDocuments = await resolveQuotationDocumentUrls(documents);
    const finalConfirmationFields = await buildFinalConfirmationResponseExtras(resolvedSavedDocuments);

    res.json({
      success: true,
      data: {
        quotationId: quotation.id,
        documents: {
          ...resolvedSavedDocuments,
          ...finalConfirmationFields
        },
        ...finalConfirmationFields
      }
    });
  } catch (error: any) {
    logError('Save final confirmation documents error', error, { quotationId: req.params.quotationId });
    if (error?.errorPayload) {
      res.status(error.statusCode || 500).json(error.errorPayload);
      return;
    }
    const message = error instanceof Error ? error.message : String(error || '');
    if (message.includes('value too long for type character varying')) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Document reference is too long to store',
          details: [{ field: 'documents', message: 'Use S3 keys or short stored references' }]
        }
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const uploadQuotationDocument = async (req: Request, res: Response): Promise<void> => {
  try {
    const role = req.user?.role;
    const isAccountManager = role === 'account-management' || role === 'hr';
    const isOperationalDocumentsEditor =
      role === 'baldev' ||
      role === 'confirmation' ||
      role === 'admin' ||
      role === 'super-admin' ||
      role === 'super-admin-manager';

    if (!req.dealer && !isAccountManager && !isOperationalDocumentsEditor) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { quotationId } = req.params;
    const where: any = { id: quotationId };
    if (isAccountManager) {
      where.status = 'approved';
    } else if (req.dealer && req.dealer.role !== 'admin') {
      where.dealerId = req.dealer.id;
    }

    const quotation = await Quotation.findOne({ where });
    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    const fieldName = typeof req.body?.field === 'string' ? req.body.field.trim() : '';
    const file = req.file as Express.Multer.File | undefined;

    if (!fieldName) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'field is required',
          details: [{ field: 'field', message: 'field is required' }]
        }
      });
      return;
    }

    if (!file) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'file is required',
          details: [{ field: 'file', message: 'file is required' }]
        }
      });
      return;
    }

    const fieldValidation = ensureQuotationDocumentUploadFieldIsValid(fieldName, file);
    if (!fieldValidation.valid) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: fieldValidation.message,
          details: [{ field: fieldName, message: fieldValidation.message }]
        }
      });
      return;
    }

    const uploadedReference = await uploadDocumentFieldFileSafe(file, fieldName, quotation.id);
    const storedValue = normalizeStoredDocumentReference(uploadedReference) || uploadedReference;
    const usableUrl = (await resolveDocumentImageUrl(storedValue)) || uploadedReference;
    const urlKey = `${fieldName}Url`;

    let persistedDocuments: Record<string, unknown> | null = null;
    if (isFinalConfirmationDocumentField(fieldName) && isOperationalDocumentsEditorRole(role)) {
      const existing = await QuotationDocument.findOne({ where: { quotationId: quotation.id } });
      const documents = await upsertFinalConfirmationDocumentFields(
        quotation.id,
        { [fieldName]: storedValue },
        existing
      );
      persistedDocuments = await resolveQuotationDocumentUrls(documents);
    }

    res.status(200).json({
      success: true,
      data: {
        field: fieldName,
        url: usableUrl,
        fileUrl: usableUrl,
        storedValue,
        [urlKey]: usableUrl,
        [fieldName]: usableUrl,
        documents: persistedDocuments ?? {
          [fieldName]: usableUrl,
          [urlKey]: usableUrl
        },
        ...(persistedDocuments
          ? await buildFinalConfirmationResponseExtras(persistedDocuments)
          : {})
      }
    });
  } catch (error: any) {
    logError('Upload quotation document error', error, {
      quotationId: req.params.quotationId,
      field: req.body?.field
    });
    if (error?.errorPayload) {
      res.status(error.statusCode || 500).json(error.errorPayload);
      return;
    }
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Save quotation documents (upsert)
export const saveQuotationDocuments = async (req: Request, res: Response): Promise<void> => {
  try {
    const role = req.user?.role;
    const isAccountManager = role === 'account-management' || role === 'hr';
    const isOperationalDocumentsEditor =
      role === 'baldev' ||
      role === 'confirmation' ||
      role === 'admin' ||
      role === 'super-admin' ||
      role === 'super-admin-manager';
    if (!req.dealer && !isAccountManager && !isOperationalDocumentsEditor) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { quotationId } = req.params;
    const where: any = { id: quotationId };
    if (isAccountManager) {
      where.status = 'approved';
    } else if (req.dealer && req.dealer.role !== 'admin') {
      where.dealerId = req.dealer.id;
    }

    const quotation = await Quotation.findOne({ where });
    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    const body: any = req.body || {};
    const existing = await QuotationDocument.findOne({ where: { quotationId: quotation.id } });
    const hasIsCompliantSenior = body.isCompliantSenior !== undefined && body.isCompliantSenior !== null;
    const isCompliantSenior = hasIsCompliantSenior
      ? body.isCompliantSenior === true ||
        body.isCompliantSenior === 'true' ||
        body.isCompliantSenior === 1 ||
        body.isCompliantSenior === '1'
      : !!existing?.isCompliantSenior;

    const aadharFrontUrl = await getUploadedFileUrlSafe(req, 'aadharFront', quotation.id);
    const aadharBackUrl = await getUploadedFileUrlSafe(req, 'aadharBack', quotation.id);
    const panImageUrl = await getUploadedFileUrlSafe(req, 'panImage', quotation.id);
    const electricityBillImageUrl = await getUploadedFileUrlSafe(req, 'electricityBillImage', quotation.id);
    const bankPassbookImageUrl = await getUploadedFileUrlSafe(req, 'bankPassbookImage', quotation.id);
    const geotagRoofPhotoUrl = await getUploadedFileUrlSafe(req, 'geotagRoofPhoto', quotation.id);
    const customerWithHousePhotoUrl = await getUploadedFileUrlSafe(req, 'customerWithHousePhoto', quotation.id);
    const propertyDocumentPdfUrl = await getUploadedFileUrlSafe(req, 'propertyDocumentPdf', quotation.id);
    const compliantAadharFrontUrl = await getUploadedFileUrlSafe(req, 'compliantAadharFront', quotation.id);
    const compliantAadharBackUrl = await getUploadedFileUrlSafe(req, 'compliantAadharBack', quotation.id);
    const compliantPanImageUrl = await getUploadedFileUrlSafe(req, 'compliantPanImage', quotation.id);
    const compliantBankPassbookImageUrl = await getUploadedFileUrlSafe(req, 'compliantBankPassbookImage', quotation.id);
    const customerFinalBillFileUrl = await getUploadedFileUrlSafe(req, 'customerFinalBillFile', quotation.id);
    const panelWarrantyFileUrl = await getUploadedFileUrlSafe(req, 'panelWarrantyFile', quotation.id);
    const inverterWarrantyFileUrl = await getUploadedFileUrlSafe(req, 'inverterWarrantyFile', quotation.id);
    const workCompletionWarrantyFileUrl = await getUploadedFileUrlSafe(req, 'workCompletionWarrantyFile', quotation.id);

    logInfo('Quotation document uploads processed', {
      quotationId: quotation.id,
      aadharFrontUrl,
      aadharBackUrl,
      panImageUrl,
      electricityBillImageUrl,
      bankPassbookImageUrl,
      geotagRoofPhotoUrl,
      customerWithHousePhotoUrl,
      propertyDocumentPdfUrl,
      compliantAadharFrontUrl,
      compliantAadharBackUrl,
      compliantPanImageUrl,
      compliantBankPassbookImageUrl,
      customerFinalBillFileUrl,
      panelWarrantyFileUrl,
      inverterWarrantyFileUrl,
      workCompletionWarrantyFileUrl
    });

    if (existing) {
      const replacements = [
        { newUrl: aadharFrontUrl, oldUrl: existing.aadharFront },
        { newUrl: aadharBackUrl, oldUrl: existing.aadharBack },
        { newUrl: panImageUrl, oldUrl: existing.panImage },
        { newUrl: electricityBillImageUrl, oldUrl: existing.electricityBillImage },
        { newUrl: bankPassbookImageUrl, oldUrl: existing.bankPassbookImage },
        { newUrl: geotagRoofPhotoUrl, oldUrl: existing.geotagRoofPhoto },
        { newUrl: customerWithHousePhotoUrl, oldUrl: existing.customerWithHousePhoto },
        { newUrl: propertyDocumentPdfUrl, oldUrl: existing.propertyDocumentPdf },
        { newUrl: compliantAadharFrontUrl, oldUrl: existing.compliantAadharFront },
        { newUrl: compliantAadharBackUrl, oldUrl: existing.compliantAadharBack },
        { newUrl: compliantPanImageUrl, oldUrl: existing.compliantPanImage },
        { newUrl: compliantBankPassbookImageUrl, oldUrl: existing.compliantBankPassbookImage },
        { newUrl: customerFinalBillFileUrl, oldUrl: (existing as any).customerFinalBillFile },
        { newUrl: panelWarrantyFileUrl, oldUrl: (existing as any).panelWarrantyFile },
        { newUrl: inverterWarrantyFileUrl, oldUrl: (existing as any).inverterWarrantyFile },
        { newUrl: workCompletionWarrantyFileUrl, oldUrl: (existing as any).workCompletionWarrantyFile }
      ];

      for (const { newUrl, oldUrl } of replacements) {
        if (newUrl && oldUrl && newUrl !== oldUrl) {
          await deleteFileFromS3IfExists(oldUrl);
        }
      }
    }

    const resolveValue = (
      uploadedUrl: string | undefined,
      bodyValue: any,
      existingValue: any
    ): any => {
      if (uploadedUrl !== undefined) return uploadedUrl;
      if (bodyValue !== undefined) return bodyValue === '' ? null : bodyValue;
      return existingValue ?? null;
    };

    const resolveMediaValue = (
      uploadedUrl: string | undefined,
      bodyValue: any,
      existingValue: any
    ): string | null => {
      if (uploadedUrl !== undefined) {
        return normalizeStoredDocumentReference(uploadedUrl) || (existingValue ?? null);
      }
      if (bodyValue === undefined) return existingValue ?? null;
      if (bodyValue === '' || bodyValue === null) return null;
      return normalizeStoredDocumentReference(bodyValue) || (existingValue ?? null);
    };

    const payload = {
      quotationId: quotation.id,
      aadharNumber: resolveValue(undefined, body.aadharNumber, existing?.aadharNumber),
      aadharFront: resolveMediaValue(aadharFrontUrl, body.aadharFront, existing?.aadharFront),
      aadharBack: resolveMediaValue(aadharBackUrl, body.aadharBack, existing?.aadharBack),
      phoneNumber: resolveValue(undefined, body.phoneNumber, existing?.phoneNumber),
      emailId: resolveValue(undefined, body.emailId, existing?.emailId),
      panNumber: resolveValue(
        undefined,
        body.panNumber ? String(body.panNumber).toUpperCase() : body.panNumber,
        existing?.panNumber
      ),
      panImage: resolveMediaValue(panImageUrl, body.panImage, existing?.panImage),
      electricityKno: resolveValue(undefined, body.electricityKno, existing?.electricityKno),
      electricityBillImage: resolveMediaValue(
        electricityBillImageUrl,
        body.electricityBillImage,
        existing?.electricityBillImage
      ),
      bankAccountNumber: resolveValue(undefined, body.bankAccountNumber, existing?.bankAccountNumber),
      bankIfsc: resolveValue(undefined, body.bankIfsc, existing?.bankIfsc),
      bankName: resolveValue(undefined, body.bankName, existing?.bankName),
      bankBranch: resolveValue(undefined, body.bankBranch, existing?.bankBranch),
      bankPassbookImage: resolveMediaValue(
        bankPassbookImageUrl,
        body.bankPassbookImage,
        existing?.bankPassbookImage
      ),
      geotagRoofPhoto: resolveMediaValue(
        geotagRoofPhotoUrl,
        body.geotagRoofPhoto,
        existing?.geotagRoofPhoto
      ),
      customerWithHousePhoto: resolveMediaValue(
        customerWithHousePhotoUrl,
        body.customerWithHousePhoto,
        existing?.customerWithHousePhoto
      ),
      propertyDocumentPdf: resolveMediaValue(
        propertyDocumentPdfUrl,
        body.propertyDocumentPdf,
        existing?.propertyDocumentPdf
      ),
      isCompliantSenior: isCompliantSenior ? true : false,
      compliantAadharNumber: resolveValue(
        undefined,
        body.compliantAadharNumber,
        existing?.compliantAadharNumber
      ),
      compliantAadharFront: resolveMediaValue(
        compliantAadharFrontUrl,
        body.compliantAadharFront,
        existing?.compliantAadharFront
      ),
      compliantAadharBack: resolveMediaValue(
        compliantAadharBackUrl,
        body.compliantAadharBack,
        existing?.compliantAadharBack
      ),
      compliantContactPhone: resolveValue(
        undefined,
        body.compliantContactPhone,
        existing?.compliantContactPhone
      ),
      compliantPanNumber: resolveValue(
        undefined,
        body.compliantPanNumber ? String(body.compliantPanNumber).toUpperCase() : body.compliantPanNumber,
        existing?.compliantPanNumber
      ),
      compliantPanImage: resolveMediaValue(
        compliantPanImageUrl,
        body.compliantPanImage,
        existing?.compliantPanImage
      ),
      compliantBankAccountNumber: resolveValue(
        undefined,
        body.compliantBankAccountNumber,
        existing?.compliantBankAccountNumber
      ),
      compliantBankIfsc: resolveValue(
        undefined,
        body.compliantBankIfsc,
        existing?.compliantBankIfsc
      ),
      compliantBankName: resolveValue(
        undefined,
        body.compliantBankName,
        existing?.compliantBankName
      ),
      compliantBankBranch: resolveValue(
        undefined,
        body.compliantBankBranch,
        existing?.compliantBankBranch
      ),
      compliantBankPassbookImage: resolveMediaValue(
        compliantBankPassbookImageUrl,
        body.compliantBankPassbookImage,
        existing?.compliantBankPassbookImage
      ),
      customerFinalBillFile: resolveMediaValue(
        customerFinalBillFileUrl,
        body.customerFinalBillFile,
        (existing as any)?.customerFinalBillFile
      ),
      panelWarrantyFile: resolveMediaValue(
        panelWarrantyFileUrl,
        body.panelWarrantyFile,
        (existing as any)?.panelWarrantyFile
      ),
      inverterWarrantyFile: resolveMediaValue(
        inverterWarrantyFileUrl,
        body.inverterWarrantyFile,
        (existing as any)?.inverterWarrantyFile
      ),
      workCompletionWarrantyFile: resolveMediaValue(
        workCompletionWarrantyFileUrl,
        body.workCompletionWarrantyFile,
        (existing as any)?.workCompletionWarrantyFile
      )
    };

    // KYC form validation (dealer/account-management upload flow). Final-confirmation-only uploads
    // should remain partial and not require base KYC fields (use POST …/final-confirmation-documents).
    // §18: propertyDocumentPdf / geotagRoofPhoto / customerWithHousePhoto are optional — do not
    // require them here (null when never uploaded is valid). See OPTIONAL_QUOTATION_DOCUMENT_MEDIA_FIELDS.
    const isKycEditor = Boolean(req.dealer) || isAccountManager;
    if (isKycEditor && !requestIsFinalConfirmationOnlyUpload(req)) {
      const details: Array<{ field: string; message: string }> = [];
      if (!payload.phoneNumber || !String(payload.phoneNumber).trim()) {
        details.push({ field: 'phoneNumber', message: 'phoneNumber is required' });
      }
      if (!payload.electricityKno || !String(payload.electricityKno).trim()) {
        details.push({ field: 'electricityKno', message: 'electricityKno is required' });
      }
      if (!payload.emailId || !String(payload.emailId).trim()) {
        details.push({ field: 'emailId', message: 'emailId is required' });
      } else {
        const email = String(payload.emailId).trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          details.push({ field: 'emailId', message: 'Invalid email format' });
        }
      }
      if (details.length > 0) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid quotation document payload',
            details
          }
        });
        return;
      }
    }

    if (payload.isCompliantSenior) {
      const compliantRequiredMissing =
        !payload.compliantContactPhone ||
        !payload.compliantAadharFront ||
        !payload.compliantAadharBack ||
        !payload.compliantPanImage ||
        !payload.compliantBankPassbookImage;
      if (compliantRequiredMissing) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Compliant documents are required when isCompliantSenior is true',
            details: [
              {
                field: 'isCompliantSenior',
                message:
                  'Set to true requires compliantContactPhone, compliantAadharFront, compliantAadharBack, compliantPanImage, and compliantBankPassbookImage'
              }
            ]
          }
        });
        return;
      }

      const compliantDetails: Array<{ field: string; message: string }> = [];
      const phoneRegex = /^\d{10}$/;
      const aadharRegex = /^\d{12}$/;
      const panRegex = /^[A-Z]{5}\d{4}[A-Z]$/;

      if (payload.compliantContactPhone && !phoneRegex.test(String(payload.compliantContactPhone).trim())) {
        compliantDetails.push({ field: 'compliantContactPhone', message: 'Compliant phone number must be 10 digits' });
      }
      if (payload.compliantAadharNumber && !aadharRegex.test(String(payload.compliantAadharNumber).trim())) {
        compliantDetails.push({ field: 'compliantAadharNumber', message: 'Compliant Aadhar number must be 12 digits' });
      }
      if (payload.compliantPanNumber && !panRegex.test(String(payload.compliantPanNumber).trim().toUpperCase())) {
        compliantDetails.push({ field: 'compliantPanNumber', message: 'PAN must be in format ABCDE1234F' });
      }
      if (compliantDetails.length > 0) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid compliant document payload',
            details: compliantDetails
          }
        });
        return;
      }
    }

    let documents;
    if (existing) {
      documents = await existing.update(payload);
    } else {
      documents = await QuotationDocument.create({
        id: uuidv4(),
        ...payload
      });
    }

    const resolvedSavedDocuments = await resolveQuotationDocumentUrls(documents);

    res.json({
      success: true,
      data: {
        quotationId: quotation.id,
        documents: resolvedSavedDocuments
      }
    });
  } catch (error) {
    logError('Save quotation documents error', error, { quotationId: req.params.quotationId });
    const statusCode = (error as any)?.statusCode;
    const errorPayload = (error as any)?.errorPayload;
    if (statusCode && errorPayload) {
      res.status(statusCode).json(errorPayload);
      return;
    }
    const message = error instanceof Error ? error.message : String(error || '');
    if (message.includes('value too long for type character varying')) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'One or more document values are too long to store',
          details: [
            {
              field: 'documents',
              message: 'Send persisted document URLs/keys only. Temporary signed URLs should not be stored.'
            }
          ]
        }
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Download quotation PDF (placeholder - implement PDF generation later)
// Download quotation PDF
export const downloadQuotationPDF = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer && !req.visitor) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { quotationId } = req.params;
    
    // Check permissions (same logic as getQuotationById)
    let quotation;
    if (req.visitor) {
      // Visitors can only download PDFs for quotations from their assigned visits
      const visitorAssignments = await VisitAssignment.findAll({
        where: { visitorId: req.visitor.id },
        attributes: ['visitId']
      });
      const visitIds = visitorAssignments.map(a => a.visitId);
      if (visitIds.length > 0) {
        const visits = await Visit.findAll({
          where: { id: visitIds, quotationId },
          attributes: ['quotationId']
        });
        if (visits.length === 0) {
          res.status(403).json({
            success: false,
            error: { code: 'AUTH_004', message: 'Insufficient permissions' }
          });
          return;
        }
      } else {
        res.status(403).json({
          success: false,
          error: { code: 'AUTH_004', message: 'Insufficient permissions' }
        });
        return;
      }
      quotation = await Quotation.findOne({ 
        where: { id: quotationId }
      });
    } else if (req.dealer) {
      // Dealers can download their own quotations, admins can download all
      const where: any = { id: quotationId };
      if (req.dealer.role !== 'admin') {
        where.dealerId = req.dealer.id;
      }
      quotation = await Quotation.findOne({ 
        where
      });
    }

    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    // PDF generation feature - to be implemented
    res.status(501).json({
      success: false,
      error: { code: 'SYS_002', message: 'PDF generation not yet implemented' }
    });
  } catch (error) {
    logError('Download quotation PDF error', error, { quotationId: req.params.quotationId });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

const getFileExtFromDocumentValue = (value: string | null | undefined, fallback = '.bin'): string => {
  if (!value) return fallback;
  const clean = value.split('?')[0];
  const ext = path.extname(clean);
  return ext || fallback;
};

const fetchS3ObjectBuffer = async (key: string): Promise<Buffer | null> => {
  const bucket = process.env.AWS_BUCKET_NAME;
  if (!bucket) return null;
  try {
    const result = await getS3Client().getObject({ Bucket: bucket, Key: key }).promise();
    if (!result.Body) return null;
    return Buffer.isBuffer(result.Body) ? result.Body : Buffer.from(result.Body as any);
  } catch (error) {
    logError('Failed to fetch S3 object for zip', error, { key });
    return null;
  }
};

const isQuotationScopedMediaRef = (urlOrKey: string, quotationId: string): boolean => {
  if (quotationIdFromInstallationMediaRef(urlOrKey, quotationId)) {
    return true;
  }
  const key = extractS3KeyOrStoredPath(urlOrKey);
  if (!key) return false;
  return (
    key.includes(`quotation-documents/${quotationId}/`) ||
    key.startsWith(`quotations/${quotationId}/documents/`)
  );
};

/** Presigned GET for private S3 installation/KYC media (§6.4.C.8). */
export const getQuotationDocumentViewUrl = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer && !req.user && !req.visitor) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { quotationId } = req.params;
    const urlParam = String(req.query.url ?? req.query.fileUrl ?? req.query.file_url ?? '').trim();
    if (!urlParam) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'url query parameter is required',
          details: [{ field: 'url', message: 'Provide url (encoded private S3 URL or object key)' }]
        }
      });
      return;
    }

    if (isPresignedS3GetUrl(urlParam) && isQuotationScopedMediaRef(urlParam, quotationId)) {
      res.json({
        success: true,
        data: {
          publicUrl: urlParam,
          url: urlParam,
          public_url: urlParam
        }
      });
      return;
    }

    const where: Record<string, unknown> = { id: quotationId };
    if (req.dealer && req.dealer.role !== 'admin') {
      where.dealerId = req.dealer.id;
    }
    if (req.user) {
      const isInventoryAdmin =
        req.user.role === 'admin' ||
        req.user.role === 'super-admin' ||
        req.user.role === 'super-admin-manager';
      const isInventoryAgent = req.user.role === 'agent' || req.user.role === 'account';
      if (!isInventoryAdmin && isInventoryAgent) {
        const mappedDealerId = await resolveDealerIdForInventoryUser(req.user.id, req.user.username);
        if (!mappedDealerId) {
          res.status(403).json({
            success: false,
            error: { code: 'AUTH_004', message: 'Insufficient permissions' }
          });
          return;
        }
        where.dealerId = mappedDealerId;
      }
    }

    const quotation = await Quotation.findOne({ where: where as any });
    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    if (!isQuotationScopedMediaRef(urlParam, quotationId)) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Media URL is not scoped to this quotation' }
      });
      return;
    }

    const publicUrl = await resolveInstallationMediaViewUrl(urlParam);
    if (!publicUrl) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: 'Could not resolve a viewable URL for the provided media reference' }
      });
      return;
    }

    res.json({
      success: true,
      data: {
        publicUrl,
        url: publicUrl,
        public_url: publicUrl
      }
    });
  } catch (error) {
    logError('Get quotation document view URL error', error, {
      quotationId: req.params.quotationId
    });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const downloadQuotationDocumentsZip = async (req: Request, res: Response): Promise<void> => {
  try {
    // Visitors are intentionally blocked from ZIP export.
    if (req.visitor) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Insufficient permissions' }
      });
      return;
    }
    if (!req.dealer && !req.user) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { quotationId } = req.params;
    const where: any = { id: quotationId };
    if (req.dealer && req.dealer.role !== 'admin') {
      where.dealerId = req.dealer.id;
    }
    if (req.user && (req.user.role === 'account-management' || req.user.role === 'hr')) {
      where.status = 'approved';
    }

    const quotation = await Quotation.findOne({
      where,
      include: [
        { model: Customer, as: 'customer', required: false },
        { model: QuotationDocument, as: 'documents', required: false }
      ]
    });

    if (!quotation) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Quotation not found' }
      });
      return;
    }

    // No QuotationDocument row yet: still stream a ZIP (manifest only + empty slots) per product contract.
    const doc =
      (quotation as any).documents ||
      ({
        aadharFront: null,
        aadharBack: null,
        compliantAadharFront: null,
        compliantAadharBack: null,
        panImage: null,
        compliantPanImage: null,
        electricityBillImage: null,
        bankPassbookImage: null,
        compliantBankPassbookImage: null,
        geotagRoofPhoto: null,
        customerWithHousePhoto: null,
        propertyDocumentPdf: null
      } as Record<string, string | null>);
    const fields: Array<{ source: string; outputBase: string; fallbackExt?: string }> = [
      { source: 'aadharFront', outputBase: 'aadhar-front' },
      { source: 'aadharBack', outputBase: 'aadhar-back' },
      { source: 'compliantAadharFront', outputBase: 'compliant-aadhar-front' },
      { source: 'compliantAadharBack', outputBase: 'compliant-aadhar-back' },
      { source: 'panImage', outputBase: 'pan' },
      { source: 'compliantPanImage', outputBase: 'compliant-pan' },
      { source: 'electricityBillImage', outputBase: 'electricity-bill' },
      { source: 'bankPassbookImage', outputBase: 'bank-passbook' },
      { source: 'compliantBankPassbookImage', outputBase: 'compliant-bank-passbook' },
      { source: 'geotagRoofPhoto', outputBase: 'geotag-roof' },
      { source: 'customerWithHousePhoto', outputBase: 'customer-with-house' },
      { source: 'propertyDocumentPdf', outputBase: 'property-document', fallbackExt: '.pdf' }
    ];

    const archive = archiver('zip', { zlib: { level: 9 } });
    const customerName = `${(quotation as any).customer?.firstName || 'Customer'} ${(quotation as any).customer?.lastName || ''}`.trim().replace(/\s+/g, '-');
    const safeCustomer = customerName.replace(/[^a-zA-Z0-9-_]/g, '') || 'Customer';
    const zipName = `${safeCustomer}-${quotation.id}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.setHeader('Cache-Control', 'no-store');

    archive.on('error', (error) => {
      logError('Quotation documents zip archive error', error, { quotationId });
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: { code: 'SYS_001', message: 'Failed to generate ZIP' }
        });
      }
    });
    archive.pipe(res);

    const detailsLines: string[] = [
      `Quotation ID: ${quotation.id}`,
      `Customer: ${(quotation as any).customer?.firstName || ''} ${(quotation as any).customer?.lastName || ''}`.trim(),
      `Generated At: ${new Date().toISOString()}`,
      ''
    ];
    if (!(quotation as any).documents) {
      detailsLines.push(
        'Note: No quotation_documents row on file yet; slots appear as MISSING until KYC documents are saved.',
        ''
      );
    }
    detailsLines.push('Documents:');

    for (const field of fields) {
      const rawValue = doc[field.source] as string | null | undefined;
      if (!rawValue) {
        detailsLines.push(`- ${field.source}: MISSING`);
        continue;
      }
      const key = extractS3KeyFromDocumentUrl(rawValue);
      if (!key) {
        detailsLines.push(`- ${field.source}: SKIPPED (non-S3 value)`);
        continue;
      }
      const fileBuffer = await fetchS3ObjectBuffer(key);
      if (!fileBuffer) {
        detailsLines.push(`- ${field.source}: MISSING/UNREADABLE (${key})`);
        continue;
      }
      const ext = getFileExtFromDocumentValue(rawValue, field.fallbackExt || '.bin');
      const outputName = `${field.outputBase}${ext}`;
      archive.append(fileBuffer, { name: outputName });
      detailsLines.push(`- ${field.source}: INCLUDED as ${outputName}`);
    }

    archive.append(detailsLines.join('\n'), { name: 'document-details.txt' });
    await archive.finalize();
  } catch (error) {
    logError('Download quotation documents zip error', error, { quotationId: req.params.quotationId });
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: { code: 'SYS_001', message: 'Internal server error' }
      });
    }
  }
};



