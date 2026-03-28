import { Request, Response } from 'express';
import AWS from 'aws-sdk';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import XLSX from 'xlsx';
import { Quotation, QuotationProduct, QuotationPaymentPhase, CustomPanel, Customer, Visit, VisitAssignment, SystemConfig, Dealer, QuotationDocument, QuotationInstallationDoc } from '../models/index-quotation';
import { Product } from '../models';
import { Op, Sequelize } from 'sequelize';
import { logError, logInfo } from '../utils/loggerHelper';
import { deleteFileFromS3IfExists } from '../middleware/upload';
import { generatePublicUrl } from '../utils/s3Service';
import { normalizePaymentModeInput } from '../utils/paymentMode';
import { quotationPaymentApiFields } from '../utils/quotationApiJson';

// Helper function to normalize catalog data - ensures all arrays are arrays (never null/undefined)
const normalizeCatalog = (catalog: any): any => {
  return {
    panels: {
      brands: Array.isArray(catalog?.panels?.brands) ? catalog.panels.brands : [],
      sizes: Array.isArray(catalog?.panels?.sizes) ? catalog.panels.sizes : []
    },
    inverters: {
      types: Array.isArray(catalog?.inverters?.types) ? catalog.inverters.types : [],
      brands: Array.isArray(catalog?.inverters?.brands) ? catalog.inverters.brands : [],
      sizes: Array.isArray(catalog?.inverters?.sizes) ? catalog.inverters.sizes : []
    },
    structures: {
      types: Array.isArray(catalog?.structures?.types) ? catalog.structures.types : [],
      // Allow any structure size on the frontend by returning an empty list
      sizes: []
    },
    meters: {
      brands: Array.isArray(catalog?.meters?.brands) ? catalog.meters.brands : []
    },
    cables: {
      brands: Array.isArray(catalog?.cables?.brands) ? catalog.cables.brands : [],
      sizes: Array.isArray(catalog?.cables?.sizes) ? catalog.cables.sizes : []
    },
    acdb: {
      options: Array.isArray(catalog?.acdb?.options) ? catalog.acdb.options : []
    },
    dcdb: {
      options: Array.isArray(catalog?.dcdb?.options) ? catalog.dcdb.options : []
    }
  };
};

// Helper function to get product catalog
const getProductCatalogData = async (): Promise<any> => {
  try {
    const config = await SystemConfig.findByPk('product_catalog');
    if (!config) {
      return null;
    }
    const catalog = typeof config.configValue === 'string' 
      ? JSON.parse(config.configValue) 
      : config.configValue;
    return normalizeCatalog(catalog);
  } catch (error) {
    logError('Failed to get product catalog', error);
    return null;
  }
};

// Get product catalog for product selection
export const getProductCatalog = async (_req: Request, res: Response): Promise<void> => {
  try {
    const catalog = await getProductCatalogData();

    if (!catalog) {
      // Return default empty structure if no catalog exists
      const defaultCatalog = normalizeCatalog(null);
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

  // Validate panel selection
  if (products.panelBrand && catalog.panels?.brands && !catalog.panels.brands.includes(products.panelBrand)) {
    errors.push(`Invalid panel brand: ${products.panelBrand}`);
  }
  if (products.panelSize && catalog.panels?.sizes && !catalog.panels.sizes.includes(products.panelSize)) {
    errors.push(`Invalid panel size: ${products.panelSize}`);
  }

  // Validate DCR panel selection
  if (products.dcrPanelBrand && catalog.panels?.brands && !catalog.panels.brands.includes(products.dcrPanelBrand)) {
    errors.push(`Invalid DCR panel brand: ${products.dcrPanelBrand}`);
  }
  if (products.dcrPanelSize && catalog.panels?.sizes && !catalog.panels.sizes.includes(products.dcrPanelSize)) {
    errors.push(`Invalid DCR panel size: ${products.dcrPanelSize}`);
  }

  // Validate non-DCR panel selection
  if (products.nonDcrPanelBrand && catalog.panels?.brands && !catalog.panels.brands.includes(products.nonDcrPanelBrand)) {
    errors.push(`Invalid non-DCR panel brand: ${products.nonDcrPanelBrand}`);
  }
  if (products.nonDcrPanelSize && catalog.panels?.sizes && !catalog.panels.sizes.includes(products.nonDcrPanelSize)) {
    errors.push(`Invalid non-DCR panel size: ${products.nonDcrPanelSize}`);
  }

  // Validate inverter selection
  // Only validate if catalog has defined options and allow custom values
  if (products.inverterType && catalog.inverters?.types && catalog.inverters.types.length > 0 && !catalog.inverters.types.includes(products.inverterType)) {
    errors.push(`Invalid inverter type: ${products.inverterType}`);
  }
  if (products.inverterBrand && catalog.inverters?.brands && catalog.inverters.brands.length > 0 && !catalog.inverters.brands.includes(products.inverterBrand)) {
    errors.push(`Invalid inverter brand: ${products.inverterBrand}`);
  }
  // Allow custom inverter sizes - only validate if catalog has sizes and user wants strict validation
  // For now, we allow any size to be entered even if not in catalog
  // if (products.inverterSize && catalog.inverters?.sizes && catalog.inverters.sizes.length > 0 && !catalog.inverters.sizes.includes(products.inverterSize)) {
  //   errors.push(`Invalid inverter size: ${products.inverterSize}`);
  // }

  // Validate structure selection
  if (products.structureType && catalog.structures?.types && !catalog.structures.types.includes(products.structureType)) {
    errors.push(`Invalid structure type: ${products.structureType}`);
  }
  // Allow custom structure sizes even if not in catalog
  // if (products.structureSize && catalog.structures?.sizes && !catalog.structures.sizes.includes(products.structureSize)) {
  //   errors.push(`Invalid structure size: ${products.structureSize}`);
  // }

  // Validate meter selection
  if (products.meterBrand && catalog.meters?.brands && !catalog.meters.brands.includes(products.meterBrand)) {
    errors.push(`Invalid meter brand: ${products.meterBrand}`);
  }

  // Validate AC cable selection
  if (products.acCableBrand && catalog.cables?.brands && !catalog.cables.brands.includes(products.acCableBrand)) {
    errors.push(`Invalid AC cable brand: ${products.acCableBrand}`);
  }
  if (products.acCableSize && catalog.cables?.sizes && !catalog.cables.sizes.includes(products.acCableSize)) {
    errors.push(`Invalid AC cable size: ${products.acCableSize}`);
  }

  // Validate DC cable selection
  if (products.dcCableBrand && catalog.cables?.brands && !catalog.cables.brands.includes(products.dcCableBrand)) {
    errors.push(`Invalid DC cable brand: ${products.dcCableBrand}`);
  }
  if (products.dcCableSize && catalog.cables?.sizes && !catalog.cables.sizes.includes(products.dcCableSize)) {
    errors.push(`Invalid DC cable size: ${products.dcCableSize}`);
  }

  // Validate ACDB selection
  if (products.acdb && catalog.acdb?.options && !catalog.acdb.options.includes(products.acdb)) {
    errors.push(`Invalid ACDB option: ${products.acdb}`);
  }

  // Validate DCDB selection
  if (products.dcdb && catalog.dcdb?.options && !catalog.dcdb.options.includes(products.dcdb)) {
    errors.push(`Invalid DCDB option: ${products.dcdb}`);
  }

  // Validate custom panels if systemType is 'customize'
  if (products.systemType === 'customize' && products.customPanels) {
    for (const panel of products.customPanels) {
      if (panel.brand && catalog.panels?.brands && !catalog.panels.brands.includes(panel.brand)) {
        errors.push(`Invalid custom panel brand: ${panel.brand}`);
      }
      if (panel.size && catalog.panels?.sizes && !catalog.panels.sizes.includes(panel.size)) {
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
 * Remaining balance for Account Management: package subtotal minus total paid (all phases).
 * Not tied to sum(phase.amount) — phases are partial allocations; the cap is quotation.subtotal.
 */
const remainingPaymentAgainstSubtotal = (
  subtotal: number | null | undefined,
  totalPaid: number
): number => {
  const base = Number(subtotal) || 0;
  const paid = Number(totalPaid);
  const safePaid = isNaN(paid) ? 0 : paid;
  return Math.max(0, base - safePaid);
};

type PaymentPhaseRecord = {
  phaseNumber: number;
  phaseName: string;
  amount: number;
  paidAmount: number;
  status: 'pending' | 'partial' | 'completed';
  dueDate?: string | null;
  paymentDate?: string | null;
  paymentMode?: 'cash' | 'upi' | 'loan' | 'netbanking' | 'bank_transfer' | 'cheque' | 'card' | 'mix' | null;
  transactionId?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
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
        updatedBy,
        updatedAt: new Date().toISOString()
      } as PaymentPhaseRecord;
    })
    .sort((a, b) => a.phaseNumber - b.phaseNumber);
};

const serializePaymentPhaseRow = (row: any): PaymentPhaseRecord => ({
  phaseNumber: Number(row.phaseNumber),
  phaseName: String(row.phaseName || ''),
  amount: Number(row.amount || 0),
  paidAmount: Number(row.paidAmount || 0),
  status: (['pending', 'partial', 'completed'].includes(String(row.status)) ? row.status : 'pending') as PaymentPhaseRecord['status'],
  dueDate: row.dueDate ? new Date(row.dueDate).toISOString() : null,
  paymentDate: row.paymentDate ? new Date(row.paymentDate).toISOString() : null,
  paymentMode: normalizePaymentModeInput(row.paymentMode) ?? null,
  transactionId: row.transactionId || null,
  updatedBy: row.updatedBy || null,
  updatedAt: row.updatedAtPhase ? new Date(row.updatedAtPhase).toISOString() : null
});

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
      // Check if customer exists by mobile
      let existingCustomer = await Customer.findOne({ where: { mobile: customer.mobile } });
      if (!existingCustomer) {
        existingCustomer = await Customer.create({
          id: uuidv4(),
          firstName: customer.firstName,
          lastName: customer.lastName,
          mobile: customer.mobile,
          email: customer.email && customer.email.trim() !== '' ? customer.email : null,
          streetAddress: customer.address.street,
          city: customer.address.city,
          state: customer.address.state,
          pincode: customer.address.pincode,
          dealerId: req.dealer.id
        });
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
      products = await applySellingPricesForAgent(products);
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
                      : pricing.subtotal))));
    
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

    const normalizedCentralSubsidy = Number(centralSubsidy ?? req.body.pricing?.centralSubsidy ?? products?.centralSubsidy ?? 0);
    const normalizedStateSubsidy = Number(stateSubsidy ?? req.body.pricing?.stateSubsidy ?? products?.stateSubsidy ?? 0);
    const normalizedTotalSubsidy = Number(totalSubsidy ?? req.body.pricing?.totalSubsidy ?? (normalizedCentralSubsidy + normalizedStateSubsidy));
    const normalizedAmountAfterSubsidy = Number(amountAfterSubsidy ?? req.body.pricing?.amountAfterSubsidy ?? (validatedSubtotal - normalizedTotalSubsidy));
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

    // Calculate valid until date (5 days from now)
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 5);

    const normalizedPaidAmount = paidAmount !== undefined && paidAmount !== null
      ? Number(paidAmount)
      : null;
    const normalizedPaymentStatus = normalizedPaidAmount !== null
      ? calculatePaymentStatus(normalizedPaidAmount, validatedTotalAmount)
      : (paymentStatus ?? null);

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
      validUntil
    });

    const normalizedPhase = products.phase || '1-Phase';

    // Create quotation products
    logInfo('Saving quotation products phase', {
      quotationId: quotation.id,
      phase: normalizedPhase
    });
    await QuotationProduct.create({
      id: uuidv4(),
      quotationId: quotation.id,
      systemType: products.systemType,
      phase: normalizedPhase,
      panelBrand: products.panelBrand,
      panelSize: products.panelSize,
      panelQuantity: products.panelQuantity,
      panelPrice: products.panelPrice,
      dcrPanelBrand: products.dcrPanelBrand,
      dcrPanelSize: products.dcrPanelSize,
      dcrPanelQuantity: products.dcrPanelQuantity,
      nonDcrPanelBrand: products.nonDcrPanelBrand,
      nonDcrPanelSize: products.nonDcrPanelSize,
      nonDcrPanelQuantity: products.nonDcrPanelQuantity,
      inverterType: products.inverterType,
      inverterBrand: products.inverterBrand,
      inverterSize: products.inverterSize,
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
      acdb: products.acdb,
      acdbPrice: products.acdbPrice,
      dcdb: products.dcdb,
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
        createdAt: quotation.createdAt,
        validUntil: quotation.validUntil
      }
    });
  } catch (error) {
    logError('Create quotation error', error, { dealerId: req.dealer?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Get quotations with pagination
export const getQuotations = async (req: Request, res: Response): Promise<void> => {
  try {
    // Authorization is handled by middleware (authorizeDealerAdminOrVisitor)
    const page = parseInt(req.query.page as string) || 1;
    const limitParam = req.query.limit as string | undefined;
    const limit = limitParam ? Math.min(parseInt(limitParam) || 20, 1000) : undefined;
    const offset = limit ? (page - 1) * limit : undefined;
    const status = req.query.status as string;
    const search = req.query.search as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const paymentType = (req.query.paymentType as string | undefined) || (req.query.paymentMode as string | undefined);
    const paymentStatus = req.query.paymentStatus as string | undefined;
    const sortBy = (req.query.sortBy as string) || 'createdAt';
    const sortOrder = (req.query.sortOrder as string) || 'desc';

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
            model: QuotationDocument,
            as: 'documents',
            required: false
          },
          {
            model: QuotationInstallationDoc,
            as: 'installationDocs',
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
        order: [[sortBy, sortOrder.toUpperCase()]]
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
            model: QuotationDocument,
            as: 'documents',
            required: false
          },
          {
            model: QuotationInstallationDoc,
            as: 'installationDocs',
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
        order: [[sortBy, sortOrder.toUpperCase()]]
      });
    }

    const phaseMap = await fetchPaymentPhasesByQuotationIds(quotations.rows.map((q: any) => String(q.id)));
    const formattedQuotations = await Promise.all(quotations.rows.map(async q => {
      const customer = (q as any).customer;
      const products = (q as any).products;
      const dealer = (q as any).dealer;
      const documents = (q as any).documents;
      const installationDocs = (q as any).installationDocs || [];
      const phaseRows = phaseMap.get(String(q.id)) || ((q as any).paymentPhases || []);
      const resolvedDocuments = await resolveQuotationDocumentUrls(documents);
      
      // Calculate pricing if products exist
      const pricing = products 
        ? calculatePricing(products, q.discount, (q as any).discountAmount)
        : null;

      const subtotalNum = (q as any).subtotal !== undefined && (q as any).subtotal !== null
        ? Number((q as any).subtotal)
        : (pricing ? Number(pricing.subtotal) : 0);
      const totalPaidForRemaining =
        phaseRows.length > 0
          ? sumPhasePaidAmounts(phaseRows as PaymentPhaseRecord[])
          : Number(q.paidAmount || 0);
      const remainingAmount = remainingPaymentAgainstSubtotal(subtotalNum, totalPaidForRemaining);
      const qAny = q as any;
      const row =
        typeof qAny.get === 'function'
          ? (qAny.get({ plain: true }) as Record<string, unknown>)
          : (q as unknown as Record<string, unknown>);

      return {
        id: q.id,
        dealerId: q.dealerId,
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
          lastName: customer.lastName,
          mobile: customer.mobile
        } : null,
        products: products ? {
          systemType: products.systemType,
          phase: products.phase
        } : null,
        systemType: q.systemType,
        ...quotationPaymentApiFields(row),
        subtotal: subtotalNum,
        paidAmount: q.paidAmount !== undefined && q.paidAmount !== null ? Number(q.paidAmount) : null,
        remaining: remainingAmount,
        remainingAmount,
        paymentDate: q.paymentDate,
        paymentStatus: q.paymentStatus,
        installments: phaseRows,
        paymentPhases: phaseRows,
        finalAmount: subtotalNum,
        installationStatus: (q as any).installationStatus || 'pending_installer',
        approvedAt: (q as any).approvedAt || null,
        installerApprovedAt: (q as any).installerApprovedAt || null,
        installationDocuments: groupInstallationDocsByType(
          installationDocs.map((doc: any) => (typeof doc.toJSON === 'function' ? doc.toJSON() : doc))
        ),
        documents: resolvedDocuments,
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
          discountAmount: pricing.discountAmount,
          totalSubsidy: pricing.totalSubsidy,
          centralSubsidy: pricing.centralSubsidy,
          stateSubsidy: pricing.stateSubsidy
        } : null,
        status: q.status,
        discount: q.discount,
        createdAt: q.createdAt,
        validUntil: q.validUntil
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

    const subtotalNum = Number(quotation.subtotal || finalPricing.subtotal);
    const totalPaidForRemaining =
      phaseRows.length > 0
        ? sumPhasePaidAmounts(phaseRows as PaymentPhaseRecord[])
        : Number(quotation.paidAmount || 0);
    const remainingAmount = remainingPaymentAgainstSubtotal(subtotalNum, totalPaidForRemaining);
    const rowById = quotation.get({ plain: true }) as unknown as Record<string, unknown>;

    res.json({
      success: true,
      data: {
        id: quotation.id,
        dealerId: quotation.dealerId,
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
          lastName: customer.lastName,
          mobile: customer.mobile,
          email: customer.email,
          address: {
            street: customer.streetAddress,
            city: customer.city,
            state: customer.state,
            pincode: customer.pincode
          }
        } : null,
        products: products ? {
          systemType: products.systemType,
          phase: products.phase,
          panelBrand: products.panelBrand,
          panelSize: products.panelSize,
          panelQuantity: products.panelQuantity,
          dcrPanelBrand: products.dcrPanelBrand,
          dcrPanelSize: products.dcrPanelSize,
          dcrPanelQuantity: products.dcrPanelQuantity,
          nonDcrPanelBrand: products.nonDcrPanelBrand,
          nonDcrPanelSize: products.nonDcrPanelSize,
          nonDcrPanelQuantity: products.nonDcrPanelQuantity,
          inverterType: products.inverterType,
          inverterBrand: products.inverterBrand,
          inverterSize: products.inverterSize,
          structureType: products.structureType,
          structureSize: products.structureSize,
          meterBrand: products.meterBrand,
          acCableBrand: products.acCableBrand,
          acCableSize: products.acCableSize,
          dcCableBrand: products.dcCableBrand,
          dcCableSize: products.dcCableSize,
          acdb: products.acdb,
          dcdb: products.dcdb,
          hybridInverter: products.hybridInverter,
          batteryCapacity: products.batteryCapacity,
          centralSubsidy: Number(products.centralSubsidy || 0),
          stateSubsidy: Number(products.stateSubsidy || 0)
        } : null,
        pricing: finalPricing,
        status: quotation.status,
        installationStatus: quotationAny.installationStatus || 'pending_installer',
        approvedAt: quotationAny.approvedAt || null,
        installerApprovedAt: quotationAny.installerApprovedAt || null,
        discount: quotation.discount,
        installationDocuments: groupInstallationDocsByType(
          installationDocs.map((doc: any) => (typeof doc.toJSON === 'function' ? doc.toJSON() : doc))
        ),
        documents: resolvedDocuments,
        ...quotationPaymentApiFields(rowById),
        subtotal: subtotalNum,
        paidAmount: quotation.paidAmount ? Number(quotation.paidAmount) : null,
        remaining: remainingAmount,
        remainingAmount,
        paymentDate: quotation.paymentDate,
        paymentStatus: quotation.paymentStatus,
        installments: phaseRows,
        paymentPhases: phaseRows,
        createdAt: quotation.createdAt,
        validUntil: quotation.validUntil
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
    if (!req.dealer) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { quotationId } = req.params;
    const discountAmount = req.body.discountAmount !== undefined && req.body.discountAmount !== null && req.body.discountAmount !== ''
      ? Number(req.body.discountAmount)
      : null;
    // Handle both number and string inputs (frontend may send string)
    const discount = typeof req.body.discount === 'string' 
      ? parseFloat(req.body.discount) 
      : req.body.discount;

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

    if (discountAmount === null && (isNaN(discount) || discount < 0 || discount > 100)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Discount must be between 0 and 100',
          details: [{ field: 'discount', message: 'Discount must be between 0 and 100' }]
        }
      });
      return;
    }

    // Admins can update all quotations, dealers only their own
    const where: any = { id: quotationId };
    if (req.dealer.role !== 'admin') {
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

    // Recalculate pricing with new discount
    // Use saved subtotal from database, not recalculated
    const quotationAny = quotation as any;
    const pricing = calculatePricing(quotationAny.products || {}, discount, discountAmount ?? undefined);
    
    // Use saved subtotal from database
    const savedSubtotal = Number(quotation.subtotal || pricing.subtotal);
    const centralSubsidy = Number(quotationAny.products?.centralSubsidy || 0);
    const stateSubsidy = Number(quotationAny.products?.stateSubsidy || 0);
    const totalSubsidy = centralSubsidy + stateSubsidy;
    const amountAfterSubsidy = savedSubtotal - totalSubsidy;
    
    // totalAmount = subtotal - subsidy - discount amount
    const computedDiscountAmount = discountAmount !== null ? discountAmount : (amountAfterSubsidy * discount) / 100;
    const newTotalAmount = amountAfterSubsidy - computedDiscountAmount;
    const newFinalAmount = newTotalAmount;
    
    await quotation.update({
      discount: discountAmount !== null ? quotation.discount : discount,
      totalAmount: newTotalAmount,
      finalAmount: newFinalAmount,
      discountAmount: computedDiscountAmount
    });

    // Refresh quotation to get updated timestamp
    await quotation.reload();

    res.json({
      success: true,
      data: {
        id: quotation.id,
        discount: quotation.discount,
        finalAmount: quotation.finalAmount,
        pricing: {
          subtotal: savedSubtotal,              // Set price (complete package price)
          totalAmount: newTotalAmount,          // Amount after discount (Subtotal - Subsidy - Discount)
          finalAmount: newFinalAmount,          // Final amount after discount
          amountAfterSubsidy: amountAfterSubsidy,
          discountAmount: computedDiscountAmount,
          totalSubsidy: totalSubsidy,
          centralSubsidy: centralSubsidy,
          stateSubsidy: stateSubsidy
        },
        updatedAt: quotation.updatedAt
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
    if (!req.dealer && !isAccountManager) {
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

    // Update quotation system type if provided
    if (products.systemType) {
      await quotation.update({ systemType: products.systemType });
    }

    // Get or create quotation products record
    const quotationAny = quotation as any;
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
        ...products,
        phase: phaseToSave
      });
    } else {
      logInfo('Updating quotation products phase', {
        quotationId: quotation.id,
        phase: products.phase || quotationProduct.phase || '1-Phase'
      });
      await quotationProduct.update({
        ...products,
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

    const updatedQuotationAny = updatedQuotation as any;
    const productsData = updatedQuotationAny?.products?.toJSON();
    const customPanelsData = updatedQuotationAny?.customPanels?.map((cp: any) => cp.toJSON()) || [];

    res.json({
      success: true,
      data: {
        id: updatedQuotation?.id,
        systemType: updatedQuotation?.systemType,
        products: productsData ? {
          ...productsData,
          customPanels: customPanelsData.length > 0 ? customPanelsData : undefined
        } : null,
        updatedAt: updatedQuotation?.updatedAt
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

// Update quotation pricing
export const updateQuotationPricing = async (req: Request, res: Response): Promise<void> => {
  try {
    const isAccountManager = req.user && (req.user.role === 'account-management' || req.user.role === 'hr');
    if (!req.dealer && !isAccountManager) {
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

    const quotationAny = quotation as any;
    const currentProducts = quotationAny.products || {};

    // Get current values or use provided values
    const newSubtotal = subtotal !== undefined ? Number(subtotal) : Number(quotation.subtotal || 0);
    const newStateSubsidy = stateSubsidy !== undefined ? Number(stateSubsidy) : Number(currentProducts.stateSubsidy || 0);
    const newCentralSubsidy = centralSubsidy !== undefined ? Number(centralSubsidy) : Number(currentProducts.centralSubsidy || 0);
    const newDiscount = discount !== undefined 
      ? (typeof discount === 'string' ? parseFloat(discount) : Number(discount))
      : Number(quotation.discount || 0);
    const newFinalAmount = finalAmount !== undefined ? Number(finalAmount) : undefined;
    const newDiscountAmount = discountAmount !== undefined && discountAmount !== null && discountAmount !== ''
      ? Number(discountAmount)
      : undefined;

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

    if (newDiscountAmount === undefined && discount !== undefined && (isNaN(newDiscount) || newDiscount < 0 || newDiscount > 100)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Discount must be between 0 and 100',
          details: [{ field: 'discount', message: 'Discount must be between 0 and 100' }]
        }
      });
      return;
    }

    // Validate subtotal
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

    // Calculate amounts
    const amountAfterSubsidy = newSubtotal - totalSubsidy;
    const effectiveDiscountAmount = newDiscountAmount !== undefined
      ? newDiscountAmount
      : (amountAfterSubsidy * newDiscount) / 100;
    const calculatedTotalAmount = amountAfterSubsidy - effectiveDiscountAmount;
    const calculatedFinalAmount = calculatedTotalAmount;
    const finalFinalAmount = newFinalAmount !== undefined ? newFinalAmount : calculatedFinalAmount;

    // Validate finalAmount is reasonable
    if (newFinalAmount !== undefined && (isNaN(newFinalAmount) || newFinalAmount < 0 || newFinalAmount > newSubtotal)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Final amount must be between 0 and subtotal',
          details: [{ field: 'finalAmount', message: `Final amount must be between 0 and ${newSubtotal}` }]
        }
      });
      return;
    }

    const normalizedPaidAmount = paidAmount !== undefined && paidAmount !== null
      ? Number(paidAmount)
      : undefined;
    const normalizedPaymentStatus = normalizedPaidAmount !== undefined
      ? calculatePaymentStatus(normalizedPaidAmount, calculatedTotalAmount)
      : (paymentStatus ?? undefined);

    // Update quotation
    await quotation.update({
      subtotal: newSubtotal,
      discount: newDiscount,
      totalAmount: calculatedTotalAmount,
      finalAmount: finalFinalAmount,
      discountAmount: effectiveDiscountAmount,
      paymentMode: paymentMode !== undefined ? paymentMode : quotation.paymentMode,
      paidAmount: normalizedPaidAmount !== undefined ? normalizedPaidAmount : quotation.paidAmount,
      paymentDate: paymentDate !== undefined ? paymentDate : quotation.paymentDate,
      paymentStatus: normalizedPaymentStatus !== undefined ? normalizedPaymentStatus : quotation.paymentStatus
    });

    // Update products with subsidies if provided
    if (stateSubsidy !== undefined || centralSubsidy !== undefined) {
      let quotationProduct = quotationAny.products || await QuotationProduct.findOne({ 
        where: { quotationId: quotation.id } 
      });

      if (!quotationProduct) {
        // Get systemType and pricing from quotation
        quotationProduct = await QuotationProduct.create({
          id: uuidv4(),
          quotationId: quotation.id,
          systemType: quotation.systemType,
          subtotal: Number(quotation.subtotal || 0),
          totalAmount: Number(quotation.totalAmount || 0),
          stateSubsidy: newStateSubsidy,
          centralSubsidy: newCentralSubsidy
        });
      } else {
        await quotationProduct.update({
          stateSubsidy: newStateSubsidy,
          centralSubsidy: newCentralSubsidy
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
          discount: newDiscount,
          discountAmount: effectiveDiscountAmount,
          totalAmount: calculatedTotalAmount,
          finalAmount: finalFinalAmount
        },
        discount: newDiscount,
        subtotal: newSubtotal,
        totalAmount: calculatedTotalAmount,
        finalAmount: finalFinalAmount,
        updatedAt: quotation.updatedAt
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
    const { paymentMode, paymentType: paymentTypeBody } = req.body as {
      paymentType?: 'loan' | 'cash' | 'mix';
      paymentMode?: 'cash' | 'upi' | 'loan' | 'netbanking' | 'bank_transfer' | 'cheque' | 'card' | 'mix';
      paymentStatus?: 'pending' | 'partial' | 'completed';
      phases?: any[];
      installments?: any[];
      paymentPhases?: any[];
    };
    const paymentType =
      paymentTypeBody ||
      (paymentMode && ['loan', 'cash', 'mix'].includes(paymentMode) ? (paymentMode as 'loan' | 'cash' | 'mix') : undefined);
    const phasePayload = req.body.phases || req.body.installments || req.body.paymentPhases;

    const isAccountManager = req.user && req.user.role === 'account-management';
    const isInventoryAdmin = req.user && (
      req.user.role === 'admin' ||
      req.user.role === 'super-admin' ||
      req.user.role === 'super-admin-manager'
    );
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

    const { actorId } = resolveActorForAudit(req);
    if (phasePayload && Array.isArray(phasePayload)) {
      const normalizedPhases = normalizePaymentPhases(phasePayload, actorId);
      for (const phase of normalizedPhases) {
        const existing = await QuotationPaymentPhase.findOne({
          where: {
            quotationId: quotation.id,
            phaseNumber: phase.phaseNumber
          }
        });

        const payload = {
          quotationId: quotation.id,
          phaseNumber: phase.phaseNumber,
          phaseName: phase.phaseName,
          amount: phase.amount,
          paidAmount: phase.paidAmount,
          status: phase.status,
          dueDate: phase.dueDate ? new Date(phase.dueDate) : null,
          paymentDate: phase.paymentDate ? new Date(phase.paymentDate) : null,
          paymentMode: phase.paymentMode || null,
          transactionId: phase.transactionId || null,
          updatedBy: actorId,
          updatedAtPhase: new Date()
        };

        if (existing) {
          await existing.update(payload);
        } else {
          await QuotationPaymentPhase.create({
            id: uuidv4(),
            ...payload
          });
        }
      }

      const phaseRows = await QuotationPaymentPhase.findAll({
        where: { quotationId: quotation.id },
        order: [['phaseNumber', 'ASC']]
      });
      const mergedPhases = (phaseRows as any[]).map(serializePaymentPhaseRow);
      const totalPaidAmount = sumPhasePaidAmounts(mergedPhases);
      const paymentCapSubtotal = Number(quotation.subtotal || 0);
      const effectivePaymentStatus = calculatePaymentStatus(totalPaidAmount, paymentCapSubtotal);
      const latestPaymentDate = mergedPhases
        .map((phase) => phase.paymentDate)
        .filter((value): value is string => !!value)
        .sort()
        .pop() || null;

      await quotation.update({
        paymentMode: paymentMode !== undefined ? paymentMode : quotation.paymentMode,
        paymentType: paymentType !== undefined ? paymentType : (quotation as any).paymentType,
        paymentStatus: effectivePaymentStatus,
        paidAmount: totalPaidAmount,
        paymentDate: latestPaymentDate ? new Date(latestPaymentDate) : quotation.paymentDate,
        paymentPhases: mergedPhases,
        paymentPlanUpdatedBy: actorId,
        paymentPlanUpdatedAt: new Date()
      });
    } else {
      await quotation.update({
        paymentMode: paymentMode !== undefined ? paymentMode : quotation.paymentMode,
        paymentType: paymentType !== undefined ? paymentType : (quotation as any).paymentType,
        paymentPlanUpdatedBy: actorId,
        paymentPlanUpdatedAt: new Date()
      });
    }

    await quotation.reload();
    const latestPhaseRows = await QuotationPaymentPhase.findAll({
      where: { quotationId: quotation.id },
      order: [['phaseNumber', 'ASC']]
    });
    const responsePhases = (latestPhaseRows as any[]).map(serializePaymentPhaseRow);
    const totalPaidSaved = quotation.paidAmount != null ? Number(quotation.paidAmount) : sumPhasePaidAmounts(responsePhases);
    const subtotalNum = Number(quotation.subtotal || 0);
    const remainingAmount = remainingPaymentAgainstSubtotal(subtotalNum, totalPaidSaved);

    res.json({
      success: true,
      data: {
        id: quotation.id,
        quotationId: quotation.id,
        paymentType: (quotation as any).paymentType || null,
        paymentMode: quotation.paymentMode,
        paymentStatus: quotation.paymentStatus,
        subtotal: subtotalNum,
        paidAmount: totalPaidSaved,
        remaining: remainingAmount,
        remainingAmount,
        installments: responsePhases,
        paymentPhases: responsePhases,
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

const getS3Client = () => {
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY;
  const secretAccessKey = process.env.AWS_SECRET_KEY;

  if (region && accessKeyId && secretAccessKey) {
    return new AWS.S3({ region, accessKeyId, secretAccessKey });
  }
  return new AWS.S3();
};

const buildS3Url = (key: string) => {
  const publicBase = process.env.AWS_S3_PUBLIC_URL;
  if (publicBase) {
    return `${publicBase.replace(/\/$/, '')}/${key}`;
  }
  const bucket = process.env.AWS_BUCKET_NAME;
  const region = process.env.AWS_REGION || 'us-east-1';
  const host = region === 'us-east-1' ? 's3.amazonaws.com' : `s3.${region}.amazonaws.com`;
  return `https://${bucket}.${host}/${key}`;
};

const uploadFileToS3 = async (file: Express.Multer.File, quotationId: string, fieldName: string) => {
  const bucket = process.env.AWS_BUCKET_NAME;
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
      ContentType: file.mimetype
    })
    .promise();

  return buildS3Url(key);
};

const getUploadedFileUrl = async (req: Request, fieldName: string, quotationId: string): Promise<string | undefined> => {
  const files = (req as any).files;
  const fieldFiles = files?.[fieldName];
  if (Array.isArray(fieldFiles) && fieldFiles.length > 0) {
    const file = fieldFiles[0] as Express.Multer.File;
    return uploadFileToS3(file, quotationId, fieldName);
  }
  return undefined;
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
    const key = trimmed.slice(publicBase.length + 1);
    return key || null;
  }

  try {
    const parsed = new URL(trimmed);
    const isS3Host = parsed.hostname.includes('amazonaws.com') || parsed.hostname.startsWith('s3.');
    if (!isS3Host) {
      return null;
    }
    const key = parsed.pathname.replace(/^\/+/, '');
    return key || null;
  } catch {
    return null;
  }
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

const resolveQuotationDocumentUrls = async (documents: any) => {
  if (!documents) return null;

  const json = typeof documents.toJSON === 'function' ? documents.toJSON() : { ...documents };
  const imageFields = [
    'aadharFront',
    'aadharBack',
    'panImage',
    'electricityBillImage',
    'bankPassbookImage',
    'compliantAadharFront',
    'compliantAadharBack',
    'compliantPanImage',
    'compliantBankPassbookImage'
  ];

  for (const field of imageFields) {
    json[field] = await resolveDocumentImageUrl(json[field]);
  }

  return json;
};

const groupInstallationDocsByType = (docs: any[]) => {
  const grouped: Record<string, any[]> = {};
  for (const doc of docs || []) {
    const key = doc.docType || 'other';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(doc);
  }
  return grouped;
};

// Save quotation documents (upsert)
export const saveQuotationDocuments = async (req: Request, res: Response): Promise<void> => {
  try {
    const isAccountManager = req.user && (req.user.role === 'account-management' || req.user.role === 'hr');
    if (!req.dealer && !isAccountManager) {
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

    const aadharFrontUrl = await getUploadedFileUrl(req, 'aadharFront', quotation.id);
    const aadharBackUrl = await getUploadedFileUrl(req, 'aadharBack', quotation.id);
    const panImageUrl = await getUploadedFileUrl(req, 'panImage', quotation.id);
    const electricityBillImageUrl = await getUploadedFileUrl(req, 'electricityBillImage', quotation.id);
    const bankPassbookImageUrl = await getUploadedFileUrl(req, 'bankPassbookImage', quotation.id);
    const compliantAadharFrontUrl = await getUploadedFileUrl(req, 'compliantAadharFront', quotation.id);
    const compliantAadharBackUrl = await getUploadedFileUrl(req, 'compliantAadharBack', quotation.id);
    const compliantPanImageUrl = await getUploadedFileUrl(req, 'compliantPanImage', quotation.id);
    const compliantBankPassbookImageUrl = await getUploadedFileUrl(req, 'compliantBankPassbookImage', quotation.id);

    logInfo('Quotation document uploads processed', {
      quotationId: quotation.id,
      aadharFrontUrl,
      aadharBackUrl,
      panImageUrl,
      electricityBillImageUrl,
      bankPassbookImageUrl,
      compliantAadharFrontUrl,
      compliantAadharBackUrl,
      compliantPanImageUrl,
      compliantBankPassbookImageUrl
    });

    if (existing) {
      const replacements = [
        { newUrl: aadharFrontUrl, oldUrl: existing.aadharFront },
        { newUrl: aadharBackUrl, oldUrl: existing.aadharBack },
        { newUrl: panImageUrl, oldUrl: existing.panImage },
        { newUrl: electricityBillImageUrl, oldUrl: existing.electricityBillImage },
        { newUrl: bankPassbookImageUrl, oldUrl: existing.bankPassbookImage },
        { newUrl: compliantAadharFrontUrl, oldUrl: existing.compliantAadharFront },
        { newUrl: compliantAadharBackUrl, oldUrl: existing.compliantAadharBack },
        { newUrl: compliantPanImageUrl, oldUrl: existing.compliantPanImage },
        { newUrl: compliantBankPassbookImageUrl, oldUrl: existing.compliantBankPassbookImage }
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
      if (uploadedUrl !== undefined) return uploadedUrl;
      if (bodyValue === undefined) return existingValue ?? null;
      if (bodyValue === '' || bodyValue === null) return null;
      if (typeof bodyValue !== 'string') return existingValue ?? null;

      const trimmed = bodyValue.trim();
      if (!trimmed) return null;
      if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) {
        return existingValue ?? null;
      }

      // Only accept persisted S3-style document values; ignore transient frontend values.
      const possibleKey = extractS3KeyFromDocumentUrl(trimmed);
      if (!possibleKey) {
        return existingValue ?? null;
      }
      return trimmed;
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
      )
    };

    if (payload.isCompliantSenior) {
      if (
        !payload.compliantAadharNumber ||
        !payload.compliantContactPhone ||
        !payload.compliantAadharFront ||
        !payload.compliantAadharBack ||
        !payload.compliantPanNumber ||
        !payload.compliantPanImage ||
        !payload.compliantBankAccountNumber ||
        !payload.compliantBankIfsc ||
        !payload.compliantBankName ||
        !payload.compliantBankBranch ||
        !payload.compliantBankPassbookImage
      ) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_001',
            message: 'Compliant documents are required when isCompliantSenior is true'
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



