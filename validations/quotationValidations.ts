import { z } from 'zod';
import { ALLOWED_PAYMENT_MODES, normalizePaymentModeInput } from '../utils/paymentMode';
import { normalizeSubsidyChequesFromRequestBody } from '../utils/subsidyChequesNormalize';
import {
  hasPdfPanelRangeKey,
  PDF_PANEL_RANGE_KEYS,
  readCommercialFlag,
  isCommercialRequestBody
} from '../utils/quotationProductPdfDisplay';
import { isTataDcrPackageSet } from '../utils/quotationTataDcrValidation';
import { isCromptonDcrSet } from '../utils/quotationCromptonDcr';

const addressSchema = z.object({
  street: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  pincode: z.string().regex(/^\d{6}$/)
});

const customerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().trim().optional().nullable().default(''),
  mobile: z.string().regex(/^\d{10}$/),
  email: z.string().trim().email('Invalid email format').optional().or(z.literal('')).nullable().default(''),
  address: addressSchema,
  notes: z.string().max(10000).optional().nullable(),
  remarks: z.string().max(10000).optional().nullable()
});

const booleanOrString = z.union([
  z.boolean(),
  z.string().transform((val) => {
    if (val.toLowerCase() === 'true') return true;
    if (val.toLowerCase() === 'false') return false;
    throw new Error('Invalid boolean');
  })
]);

/** Plain object — no refinements (Zod v4 forbids `.partial()` on schemas with refinements). */
const productsSchemaObject = z.object({
  systemType: z.enum(['on-grid', 'off-grid', 'hybrid', 'dcr', 'non-dcr', 'both', 'customize']),
  phase: z.enum(['1-Phase', '3-Phase'], 'Phase must be 1-Phase or 3-Phase').optional(),
  panelBrand: z.string().nullish(),
  panelSize: z.string().nullish(),
  panelQuantity: z.number().int().nonnegative().nullish(),
  panelPrice: z.number().nonnegative().nullish(),
  dcrPanelBrand: z.string().nullish(),
  dcrPanelSize: z.string().nullish(),
  dcrPanelQuantity: z.number().int().nonnegative().nullish(),
  nonDcrPanelBrand: z.string().nullish(),
  nonDcrPanelSize: z.string().nullish(),
  nonDcrPanelQuantity: z.number().int().nonnegative().nullish(),
  inverterType: z.string().nullish(),
  inverterBrand: z.string().nullish(),
  inverterSize: z.string().nullish(),
  inverterPrice: z.number().nonnegative().nullish(),
  structureType: z.string().nullish(),
  structureSize: z.string().nullish(),
  structurePrice: z.number().nonnegative().nullish(),
  meterBrand: z.string().nullish(),
  meterPrice: z.number().nonnegative().nullish(),
  acCableBrand: z.string().nullish(),
  acCableSize: z.string().nullish(),
  acCablePrice: z.number().nonnegative().nullish(),
  dcCableBrand: z.string().nullish(),
  dcCableSize: z.string().nullish(),
  dcCablePrice: z.number().nonnegative().nullish(),
  acdb: z.string().nullish(),
  acdbPrice: z.number().nonnegative().nullish(),
  dcdb: z.string().nullish(),
  dcdbPrice: z.number().nonnegative().nullish(),
  hybridInverter: z.string().nullish(),
  batteryCapacity: z.string().nullish(),
  batteryPrice: z.number().nonnegative().nullish(),
  systemPrice: z.number().nonnegative().nullish(),
  system_price: z.number().nonnegative().nullish(),
  centralSubsidy: z.number().nonnegative().default(0),
  stateSubsidy: z.number().nonnegative().default(0),
  pdfUsePanelSizeRange: booleanOrString.optional(),
  pdf_use_panel_size_range: booleanOrString.optional(),
  pdfUseInverterBrandOptions: booleanOrString.optional(),
  pdf_use_inverter_brand_options: booleanOrString.optional(),
  pdfCommercialSet: booleanOrString.optional(),
  pdf_commercial_set: booleanOrString.optional(),
  isCommercial: booleanOrString.optional(),
  pdfPanelRangeKey: z
    .union([z.enum(PDF_PANEL_RANGE_KEYS), z.literal(''), z.null()])
    .nullish(),
  pdf_panel_range_key: z
    .union([z.enum(PDF_PANEL_RANGE_KEYS), z.literal(''), z.null()])
    .nullish(),
  pdfDcrPanelRangeKey: z
    .union([z.enum(PDF_PANEL_RANGE_KEYS), z.literal(''), z.null()])
    .nullish(),
  pdf_dcr_panel_range_key: z
    .union([z.enum(PDF_PANEL_RANGE_KEYS), z.literal(''), z.null()])
    .nullish(),
  pdfNonDcrPanelRangeKey: z
    .union([z.enum(PDF_PANEL_RANGE_KEYS), z.literal(''), z.null()])
    .nullish(),
  pdf_non_dcr_panel_range_key: z
    .union([z.enum(PDF_PANEL_RANGE_KEYS), z.literal(''), z.null()])
    .nullish(),
  panelType: z.string().max(64).nullish(),
  panel_type: z.string().max(64).nullish(),
  inaDcrPackage: booleanOrString.optional(),
  ina_dcr_package: booleanOrString.optional(),
  customPanels: z.array(z.object({
    brand: z.string().min(1),
    size: z.string().min(1),
    quantity: z.number().int().positive(),
    type: z.enum(['dcr', 'non-dcr']),
    price: z.number().nonnegative()
  })).nullish()
});

type ProductsSchemaInput = z.infer<typeof productsSchemaObject>;

const refineProductsSubsidy = (
  val: Partial<ProductsSchemaInput> & Record<string, unknown>,
  ctx: z.RefinementCtx
): void => {
  const systemType = String(val.systemType || '').trim().toLowerCase();
  if (!systemType) return;
  // Commercial DCR/BOTH legitimately have no subsidy — skip the "required" rule.
  const commercial = readCommercialFlag(val);
  const centralSubsidy = Number(val.centralSubsidy ?? 0);
  const stateSubsidy = Number(val.stateSubsidy ?? 0);
  if (systemType === 'non-dcr') {
    if (centralSubsidy !== 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'centralSubsidy must be 0 for non-dcr system type',
        path: ['centralSubsidy']
      });
    }
    if (stateSubsidy !== 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'stateSubsidy must be 0 for non-dcr system type',
        path: ['stateSubsidy']
      });
    }
    return;
  }
  if (systemType === 'dcr' || systemType === 'both') {
    if (!commercial && centralSubsidy <= 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'centralSubsidy is required for dcr and both system types',
        path: ['centralSubsidy']
      });
    }
  }
};

const refineProductsPanelQuantity = (
  val: Partial<ProductsSchemaInput> & Record<string, unknown>,
  ctx: z.RefinementCtx
): void => {
  if (hasPdfPanelRangeKey(val)) return;
  if (isTataDcrPackageSet(val)) return;
  if (isCromptonDcrSet(val)) return;
  const missingQty = (size: unknown, qty: unknown) => {
    const hasSize = size !== undefined && size !== null && String(size).trim() !== '';
    if (!hasSize) return false;
    return qty === undefined || qty === null || Number(qty) <= 0;
  };
  if (val.systemType === 'both') {
    const missingBrand = (brand: unknown) =>
      brand === undefined || brand === null || String(brand).trim() === '';
    if (missingBrand(val.dcrPanelBrand)) {
      ctx.addIssue({
        code: 'custom',
        message: 'dcrPanelBrand is required for both system type',
        path: ['dcrPanelBrand']
      });
    }
    if (missingBrand(val.nonDcrPanelBrand)) {
      ctx.addIssue({
        code: 'custom',
        message: 'nonDcrPanelBrand is required for both system type',
        path: ['nonDcrPanelBrand']
      });
    }
    if (missingQty(val.dcrPanelSize, val.dcrPanelQuantity)) {
      ctx.addIssue({
        code: 'custom',
        message: 'dcrPanelQuantity required when PDF range is not set',
        path: ['dcrPanelQuantity']
      });
    }
    if (missingQty(val.nonDcrPanelSize, val.nonDcrPanelQuantity)) {
      ctx.addIssue({
        code: 'custom',
        message: 'nonDcrPanelQuantity required when PDF range is not set',
        path: ['nonDcrPanelQuantity']
      });
    }
    return;
  }
  if (val.systemType === 'customize') return;
  if (missingQty(val.panelSize, val.panelQuantity)) {
    ctx.addIssue({
      code: 'custom',
      message: 'panelQuantity required when PDF range is not set',
      path: ['panelQuantity']
    });
  }
};

const applyProductRefinements = (
  val: Partial<ProductsSchemaInput> & Record<string, unknown>,
  ctx: z.RefinementCtx
): void => {
  refineProductsPanelQuantity(val, ctx);
  refineProductsSubsidy(val, ctx);
};

const productsSchema = productsSchemaObject.superRefine(applyProductRefinements);

/**
 * PATCH products — panel qty refinements only.
 * Subsidy is enforced in the controller via `validateSubsidyForSystemType`, which can
 * see the persisted `pdfCommercialSet` on the quotation (Zod only sees the PATCH body).
 */
const productsPartialSchema = productsSchemaObject.partial().superRefine((val, ctx) => {
  refineProductsPanelQuantity(val, ctx);
});

/** Copy commercial flags from request root / pricing into `products` before Zod refinements. */
const withCommercialPropagatedToProducts = <T extends Record<string, unknown>>(raw: T): T => {
  if (!raw || typeof raw !== 'object') return raw;
  const products = raw.products;
  if (!products || typeof products !== 'object' || Array.isArray(products)) return raw;
  if (!isCommercialRequestBody(raw as Record<string, unknown>)) return raw;
  return {
    ...raw,
    products: {
      ...(products as Record<string, unknown>),
      pdfCommercialSet: true,
      pdf_commercial_set: true,
      isCommercial: true
    }
  };
};

const paymentModeEnum = z.enum(
  ['cash', 'upi', 'loan', 'netbanking', 'bank_transfer', 'cheque', 'card', 'mix'],
  { message: 'Invalid payment mode' }
);

const paymentStatusEnum = z.enum(['pending', 'partial', 'completed'], {
  message: 'Invalid payment status'
});

// Accept number or string that can be converted to number (disallow empty string)
const numberOrStringNumber = z.union([
  z.number(),
  z.string().transform((val) => {
    if (val.trim() === '') {
      throw new Error('Invalid number');
    }
    const num = Number(val);
    if (isNaN(num)) throw new Error('Invalid number');
    return num;
  })
]);

export const createQuotationSchema = z.preprocess(
  (raw) => withCommercialPropagatedToProducts((raw ?? {}) as Record<string, unknown>),
  z.object({
  customerId: z.string().nullish(),
  customer: customerSchema.nullish(),
  products: productsSchema,
  discount: z.number().min(0).max(100).default(0),
  // Pricing fields - required at root level
  subtotal: numberOrStringNumber.pipe(z.number().positive('Subtotal must be greater than 0')).optional(),
  totalAmount: numberOrStringNumber.pipe(z.number().nonnegative('Total amount must be a valid number')).optional(),
  finalAmount: numberOrStringNumber.pipe(z.number().nonnegative('Final amount must be a valid number')).optional(),
  // Optional payment fields (single payment)
  paymentMode: paymentModeEnum.optional(),
  paidAmount: numberOrStringNumber.pipe(z.number().nonnegative()).optional(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Payment date must be in YYYY-MM-DD format').optional(),
  paymentStatus: paymentStatusEnum.optional(),
  // Optional pricing fields
  centralSubsidy: z.number().nonnegative().default(0).nullish(),
  stateSubsidy: z.number().nonnegative().default(0).nullish(),
  totalSubsidy: z.number().nonnegative().default(0).nullish(),
  amountAfterSubsidy: z.number().nonnegative().default(0).nullish(),
  discountAmount: z.number().nonnegative().default(0).nullish(),
  // §23 — additional quotation same customer (keep old + create new)
  allowAdditionalQuotation: booleanOrString.optional(),
  allow_additional_quotation: booleanOrString.optional(),
  allowDuplicateMobile: booleanOrString.optional(),
  allow_duplicate_mobile: booleanOrString.optional(),
  sourceQuotationId: z.string().max(64).optional().nullable(),
  source_quotation_id: z.string().max(64).optional().nullable(),
  previousQuotationId: z.string().max(64).optional().nullable(),
  previous_quotation_id: z.string().max(64).optional().nullable(),
  revisesQuotationId: z.string().max(64).optional().nullable(),
  revises_quotation_id: z.string().max(64).optional().nullable(),
  notes: z.string().max(10000).optional().nullable(),
  isCurrent: booleanOrString.optional(),
  is_current: booleanOrString.optional(),
  setAsCurrent: booleanOrString.optional(),
  set_as_current: booleanOrString.optional(),
  // Commercial DCR/BOTH — accept at root so Zod does not strip them before the controller.
  pdfCommercialSet: booleanOrString.optional(),
  pdf_commercial_set: booleanOrString.optional(),
  isCommercial: booleanOrString.optional(),
  // Optional nested pricing object (for backward compatibility)
  pricing: z.object({
    subtotal: numberOrStringNumber.pipe(z.number().positive()).nullish(),
    totalAmount: numberOrStringNumber.pipe(z.number().nonnegative()).nullish(),
    finalAmount: numberOrStringNumber.pipe(z.number().nonnegative()).nullish(),
    centralSubsidy: numberOrStringNumber.pipe(z.number().nonnegative()).nullish(),
    stateSubsidy: numberOrStringNumber.pipe(z.number().nonnegative()).nullish(),
    totalSubsidy: numberOrStringNumber.pipe(z.number().nonnegative()).nullish(),
    amountAfterSubsidy: numberOrStringNumber.pipe(z.number().nonnegative()).nullish(),
    discountAmount: numberOrStringNumber.pipe(z.number().nonnegative()).nullish(),
    pdfCommercialSet: booleanOrString.optional(),
    pdf_commercial_set: booleanOrString.optional(),
    isCommercial: booleanOrString.optional()
  }).nullish()
})
  .refine((data) => data.customerId || data.customer, {
  message: 'Either customerId or customer object is required'
})
  .refine((data) => data.subtotal !== undefined || data.pricing?.subtotal !== undefined, {
    path: ['subtotal'],
    message: 'Subtotal is required and must be greater than 0'
  })
  .refine((data) => data.totalAmount !== undefined || data.pricing?.totalAmount !== undefined, {
    path: ['totalAmount'],
    message: 'Total amount is required'
  })
  .refine((data) => data.finalAmount !== undefined || data.pricing?.finalAmount !== undefined, {
    path: ['finalAmount'],
    message: 'Final amount is required'
  })
);

export const updateDiscountSchema = z.object({
  // ≤100 = percentage; >100 = absolute INR (Final Settlement / quotation edit convention).
  discount: numberOrStringNumber.pipe(z.number().nonnegative()).optional(),
  discountAmount: numberOrStringNumber.pipe(z.number().nonnegative()).optional()
}).refine((data) => data.discount !== undefined || data.discountAmount !== undefined, {
  message: 'Either discount or discountAmount must be provided'
});

export const updateProductsSchema = z.preprocess(
  (raw) => withCommercialPropagatedToProducts((raw ?? {}) as Record<string, unknown>),
  z.object({
  products: productsPartialSchema.refine((val) => {
    if (val.systemType === 'customize') {
      return Array.isArray(val.customPanels) && val.customPanels.length > 0;
    }
    return true;
  }, {
    message: 'customPanels is required when systemType is customize'
  }),
  // Commercial flags may also arrive at the PATCH root (alongside nested products).
  pdfCommercialSet: booleanOrString.optional(),
  pdf_commercial_set: booleanOrString.optional(),
  isCommercial: booleanOrString.optional()
}).refine((data) => Object.keys(data.products || {}).length > 0, {
  message: 'At least one products field must be provided'
})
);

export const updatePricingSchema = z.object({
  subtotal: numberOrStringNumber.pipe(z.number().nonnegative()).optional(),
  stateSubsidy: numberOrStringNumber.pipe(z.number().nonnegative()).optional(),
  centralSubsidy: numberOrStringNumber.pipe(z.number().nonnegative()).optional(),
  // ≤100 = percentage; >100 allowed as absolute INR when discountAmount omitted.
  discount: numberOrStringNumber.pipe(z.number().nonnegative()).optional(),
  discountAmount: numberOrStringNumber.pipe(z.number().nonnegative()).optional(),
  finalAmount: numberOrStringNumber.pipe(z.number().nonnegative()).optional(),
  totalAmount: numberOrStringNumber.pipe(z.number().nonnegative()).optional(),
  paymentMode: paymentModeEnum.optional(),
  paidAmount: numberOrStringNumber.pipe(z.number().nonnegative()).optional(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Payment date must be in YYYY-MM-DD format').optional(),
  paymentStatus: paymentStatusEnum.optional(),
  // Keep commercial flags after Zod parse (validate middleware replaces req.body).
  pdfCommercialSet: booleanOrString.optional(),
  pdf_commercial_set: booleanOrString.optional(),
  isCommercial: booleanOrString.optional()
}).refine((data) => {
  // At least one field must be provided and not undefined
  const hasValue = Object.keys(data).some(key => data[key as keyof typeof data] !== undefined);
  return hasValue;
}, {
  message: 'At least one pricing field must be provided'
});

const rawPaymentPhaseSchema = z.object({
  phaseNumber: z.coerce.number().int().positive(),
  phaseName: z.string().min(1),
  amount: z.coerce.number().min(0),
  paidAmount: z.coerce.number().min(0).optional(),
  paid_amount: z.coerce.number().min(0).optional(),
  paidAmt: z.coerce.number().min(0).optional(),
  paid: z.coerce.number().min(0).optional(),
  status: paymentStatusEnum.optional(),
  dueDate: z.union([z.string(), z.null()]).optional(),
  paymentDate: z.union([z.string(), z.null()]).optional(),
  paymentMode: z.union([z.string(), z.null()]).optional(),
  transactionId: z.union([z.string(), z.null()]).optional(),
  transaction_id: z.union([z.string(), z.null()]).optional(),
  note: z.union([z.string(), z.null()]).optional()
});

const resolvePhasePaid = (p: z.infer<typeof rawPaymentPhaseSchema>): number =>
  Number(p.paidAmount ?? p.paid_amount ?? p.paidAmt ?? p.paid ?? 0);

const subsidyChequeRowSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  details: z.string().optional(),
  chequeDetails: z.string().optional(),
  amount: z.union([z.number(), z.string()]).optional(),
  status: z.enum(['pending', 'cleared']).optional(),
  clearedAt: z.union([z.string(), z.null()]).optional(),
  cleared_at: z.union([z.string(), z.null()]).optional()
});

export const updatePaymentDetailsSchema = z
  .object({
    paymentType: z.enum(['loan', 'cash', 'mix']).optional(),
    paymentMode: z.union([z.string(), z.null()]).optional(),
    paymentStatus: paymentStatusEnum.optional(),
    /** Status-only Final Settlement may send remaining: 0 without rewriting phases. */
    remaining: numberOrStringNumber.pipe(z.number().nonnegative()).optional(),
    remainingAmount: numberOrStringNumber.pipe(z.number().nonnegative()).optional(),
    finalSettlementAmount: numberOrStringNumber.pipe(z.number().nonnegative()).optional(),
    final_settlement_amount: numberOrStringNumber.pipe(z.number().nonnegative()).optional(),
    finalSettlementApplied: booleanOrString.optional(),
    final_settlement_applied: booleanOrString.optional(),
    replaceInstallments: z.boolean().optional(),
    replace: z.boolean().optional(),
    phases: z.array(rawPaymentPhaseSchema).optional(),
    installments: z.array(rawPaymentPhaseSchema).optional(),
    paymentPhases: z.array(rawPaymentPhaseSchema).optional(),
    subsidyCheques: z.array(subsidyChequeRowSchema).optional(),
    subsidy_cheques: z.array(subsidyChequeRowSchema).optional(),
    /** §30 Account Management Cost of site */
    siteCost: z.union([z.number(), z.string()]).optional(),
    site_cost: z.union([z.number(), z.string()]).optional(),
    costOfSite: z.union([z.number(), z.string()]).optional(),
    cost_of_site: z.union([z.number(), z.string()]).optional()
  })
  .refine(
    (data) => {
      const hasPhases =
        Array.isArray(data.phases) ||
        Array.isArray(data.installments) ||
        Array.isArray(data.paymentPhases);
      const isStatusOnly =
        data.paymentStatus !== undefined ||
        data.remaining !== undefined ||
        data.remainingAmount !== undefined ||
        data.finalSettlementAmount !== undefined ||
        data.final_settlement_amount !== undefined ||
        data.finalSettlementApplied !== undefined ||
        data.final_settlement_applied !== undefined;
      const hasSiteCost =
        data.siteCost !== undefined ||
        data.site_cost !== undefined ||
        data.costOfSite !== undefined ||
        data.cost_of_site !== undefined;
      const hasOther =
        data.paymentType !== undefined ||
        data.paymentMode !== undefined ||
        data.subsidyCheques !== undefined ||
        data.subsidy_cheques !== undefined ||
        hasSiteCost;
      return hasPhases || isStatusOnly || hasOther;
    },
    {
      message:
        'Provide phases/installments, siteCost, or a status-only payload (paymentStatus / remaining / finalSettlement*)',
      path: ['phases']
    }
  )
  .transform((data) => {
    const hadPhaseInput =
      Array.isArray(data.phases) ||
      Array.isArray(data.installments) ||
      Array.isArray(data.paymentPhases);
    const rawList = hadPhaseInput
      ? (data.phases ?? data.installments ?? data.paymentPhases ?? [])
      : [];
    const topMode = normalizePaymentModeInput(data.paymentMode);
    let carry = topMode;
    const phases = rawList.map((p) => {
      const paidAmount = resolvePhasePaid(p);
      const amount = Number(p.amount ?? 0);
      let status = p.status;
      if (!status) {
        if (paidAmount <= 0) status = 'pending';
        else if (amount > 0 && paidAmount >= amount) status = 'completed';
        else status = 'partial';
      }
      let paymentMode = normalizePaymentModeInput(p.paymentMode);
      const needsMode =
        paidAmount > 0 ||
        status === 'partial' ||
        status === 'completed';
      if (needsMode && !paymentMode) {
        paymentMode = carry ?? topMode;
      }
      if (paymentMode) carry = paymentMode;
      const rawTid = p.transactionId ?? p.transaction_id;
      return {
        phaseNumber: p.phaseNumber,
        phaseName: p.phaseName,
        amount,
        paidAmount,
        status,
        dueDate: p.dueDate === null ? undefined : p.dueDate,
        paymentDate: p.paymentDate === null ? undefined : p.paymentDate,
        paymentMode,
        transactionId:
          rawTid === undefined || rawTid === null || rawTid === ''
            ? undefined
            : String(rawTid),
        note:
          p.note === undefined || p.note === null
            ? undefined
            : String(p.note).trim()
      };
    });
    const subsidyCheques =
      data.subsidyCheques !== undefined || data.subsidy_cheques !== undefined
        ? normalizeSubsidyChequesFromRequestBody(data.subsidyCheques ?? data.subsidy_cheques ?? [])
        : undefined;
    const finalSettlementAmount =
      data.finalSettlementAmount !== undefined
        ? Number(data.finalSettlementAmount)
        : data.final_settlement_amount !== undefined
          ? Number(data.final_settlement_amount)
          : undefined;
    const finalSettlementAppliedRaw =
      data.finalSettlementApplied !== undefined
        ? data.finalSettlementApplied
        : data.final_settlement_applied;
    const finalSettlementApplied =
      finalSettlementAppliedRaw === undefined
        ? undefined
        : Boolean(finalSettlementAppliedRaw === true || String(finalSettlementAppliedRaw) === 'true' || String(finalSettlementAppliedRaw) === '1');
    const remaining =
      data.remaining !== undefined
        ? Number(data.remaining)
        : data.remainingAmount !== undefined
          ? Number(data.remainingAmount)
          : undefined;
    return {
      paymentType: data.paymentType,
      paymentMode: topMode,
      paymentStatus: data.paymentStatus,
      remaining,
      remainingAmount: remaining,
      finalSettlementAmount,
      finalSettlementApplied,
      replaceInstallments: data.replaceInstallments,
      replace: data.replace,
      // Critical: omit phases when absent so status-only Final Settlement skips phase rewrite / VAL_012
      ...(hadPhaseInput ? { phases } : {}),
      subsidyCheques,
      siteCost: data.siteCost,
      site_cost: data.site_cost,
      costOfSite: data.costOfSite,
      cost_of_site: data.cost_of_site
    };
  })
  .superRefine((data, ctx) => {
    if (!Array.isArray(data.phases)) return;
    const nums = data.phases.map((p) => p.phaseNumber);
    if (new Set(nums).size !== nums.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'phaseNumber must be unique per quotation',
        path: ['phases']
      });
    }
    data.phases.forEach((p, i) => {
      if (p.paidAmount > p.amount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'paidAmount cannot be greater than amount',
          path: ['phases', i, 'paidAmount']
        });
      }
      const needsMode =
        p.paidAmount > 0 ||
        p.status === 'partial' ||
        p.status === 'completed';
      if (needsMode && !p.paymentMode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'paymentMode is required when paidAmount > 0 or status is partial/completed (use a valid mode per phase, or set top-level paymentMode, or inherit from an earlier phase)',
          path: ['phases', i, 'paymentMode']
        });
      }
      if (
        p.paymentMode &&
        !(ALLOWED_PAYMENT_MODES as readonly string[]).includes(p.paymentMode)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid paymentMode. Allowed: ${ALLOWED_PAYMENT_MODES.join(', ')}`,
          path: ['phases', i, 'paymentMode']
        });
      }
    });
  });

export const finalSettlementSchema = z.object({
  // Amount aliases — settlement = remaining only. Any one is accepted.
  amount: numberOrStringNumber.pipe(z.number().nonnegative()).optional(),
  settlementAmount: numberOrStringNumber.pipe(z.number().nonnegative()).optional(),
  discountAmount: numberOrStringNumber.pipe(z.number().nonnegative()).optional(),
  finalSettlementAmount: numberOrStringNumber.pipe(z.number().nonnegative()).optional(),
  // Echo fields the client sends (validate middleware replaces req.body, so whitelist them).
  finalAmount: numberOrStringNumber.pipe(z.number().nonnegative()).optional(),
  paymentStatus: paymentStatusEnum.optional(),
  remaining: numberOrStringNumber.pipe(z.number().nonnegative()).optional(),
  remainingAmount: numberOrStringNumber.pipe(z.number().nonnegative()).optional(),
  finalSettlementApplied: booleanOrString.optional()
}).refine(
  (data) =>
    data.amount !== undefined ||
    data.settlementAmount !== undefined ||
    data.discountAmount !== undefined ||
    data.finalSettlementAmount !== undefined,
  {
    message: 'amount (or settlementAmount / discountAmount / finalSettlementAmount) is required',
    path: ['amount']
  }
);

/**
 * Revert final settlement.
 * Body is optional (usually empty) — handler recomputes everything server-side.
 */
export const revertFinalSettlementSchema = z.preprocess(
  (v) => (v === undefined || v === null ? {} : v),
  z.object({}).passthrough()
);

export const updatePaymentModeSchema = z.object({
  paymentMode: z
    .union([z.string(), z.null()])
    .transform((v) => normalizePaymentModeInput(v))
    .refine((v) => v !== undefined, { message: 'Invalid or missing payment mode' })
});

const installationReleaseBodySchema = z.object({
  installationReadyForInstaller: z
    .union([z.boolean(), z.string()])
    .transform((value) => {
      if (typeof value === 'boolean') return value;
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
      throw new Error('installationReadyForInstaller must be boolean');
    }),
  installationReleasedAt: z
    .union([z.string(), z.date(), z.null()])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      if (value instanceof Date) return value.toISOString();
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error('installationReleasedAt must be a valid date');
      }
      return parsed.toISOString();
    })
});

/** Accept camelCase or snake_case keys from Payment Management UI. */
export const updateInstallationReleaseSchema = z.preprocess((body) => {
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  return {
    installationReadyForInstaller:
      raw.installationReadyForInstaller ?? raw.installation_ready_for_installer,
    installationReleasedAt: raw.installationReleasedAt ?? raw.installation_released_at
  };
}, installationReleaseBodySchema);

const yyyyMmDd = /^\d{4}-\d{2}-\d{2}$/;

/** Planned installation calendar date; camelCase or snake_case (frontend fallbacks). */
export const updateInstallationScheduledAtSchema = z
  .object({
    installationScheduledAt: z.union([z.string(), z.null()]).optional(),
    installation_scheduled_at: z.union([z.string(), z.null()]).optional()
  })
  .superRefine((data, ctx) => {
    const hasCamel = data.installationScheduledAt !== undefined;
    const hasSnake = data.installation_scheduled_at !== undefined;
    if (!hasCamel && !hasSnake) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'installationScheduledAt or installation_scheduled_at is required',
        path: ['installationScheduledAt']
      });
      return;
    }
    const val = hasCamel ? data.installationScheduledAt : data.installation_scheduled_at;
    if (val !== null && val !== undefined && (typeof val !== 'string' || !yyyyMmDd.test(val))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Must be YYYY-MM-DD or null',
        path: hasCamel ? ['installationScheduledAt'] : ['installation_scheduled_at']
      });
    }
  })
  .transform((data) => {
    const hasCamel = data.installationScheduledAt !== undefined;
    const val = hasCamel ? data.installationScheduledAt : data.installation_scheduled_at;
    return { installationScheduledAt: val === undefined ? null : val };
  });

const aadharRegex = /^\d{12}$/;
const phoneRegex = /^\d{10}$/;
const panRegex = /^[A-Z]{5}\d{4}[A-Z]$/;

const panSchema = z
  .string()
  .min(1)
  .transform((val) => val.toUpperCase())
  .refine((val) => panRegex.test(val), { message: 'PAN must be in format ABCDE1234F' });

/** Empty / null multipart values → undefined so optional media never fail min(1). §18 */
const optionalMediaRef = z.preprocess(
  (val) => (val === '' || val === null ? undefined : val),
  z.string().min(1).optional()
);

/** Subsidy rules for create/update when effective system type is known (partial PATCH). */
export const validateSubsidyForSystemType = (
  systemType: string,
  centralSubsidy: number,
  stateSubsidy: number,
  commercial = false
): { valid: boolean; details: Array<{ field: string; message: string }> } => {
  const normalized = String(systemType || '').trim().toLowerCase();
  const details: Array<{ field: string; message: string }> = [];
  if (normalized === 'non-dcr') {
    if (centralSubsidy !== 0) {
      details.push({ field: 'centralSubsidy', message: 'centralSubsidy must be 0 for non-dcr system type' });
    }
    if (stateSubsidy !== 0) {
      details.push({ field: 'stateSubsidy', message: 'stateSubsidy must be 0 for non-dcr system type' });
    }
  } else if (normalized === 'dcr' || normalized === 'both') {
    // Commercial DCR/BOTH have no subsidy — skip the "required" rule.
    if (!commercial && centralSubsidy <= 0) {
      details.push({
        field: 'centralSubsidy',
        message: 'centralSubsidy is required for dcr and both system types'
      });
    }
  }
  return { valid: details.length === 0, details };
};

export const quotationDocumentsSchema = z.object({
  aadharNumber: z.string().min(1).optional().refine((val) => !val || aadharRegex.test(val), {
    message: 'Aadhar number must be 12 digits'
  }),
  aadharFront: z.string().min(1).optional(),
  aadharBack: z.string().min(1).optional(),
  phoneNumber: z.string().min(1).optional().refine((val) => !val || phoneRegex.test(val), {
    message: 'Phone number must be 10 digits'
  }),
  emailId: z.string().email().optional(),
  panNumber: panSchema.optional(),
  panImage: z.string().min(1).optional(),
  electricityKno: z.string().min(1).optional(),
  electricityBillImage: z.string().min(1).optional(),
  bankAccountNumber: z.string().min(1).optional(),
  bankIfsc: z.string().min(1).optional(),
  bankName: z.string().min(1).optional(),
  bankBranch: z.string().min(1).optional(),
  bankPassbookImage: z.string().min(1).optional(),
  // §18 — optional; submit without these must succeed
  geotagRoofPhoto: optionalMediaRef,
  customerWithHousePhoto: optionalMediaRef,
  propertyDocumentPdf: optionalMediaRef,
  isCompliantSenior: booleanOrString.optional(),
  compliantAadharNumber: z.string().min(1).optional().refine((val) => !val || aadharRegex.test(val), {
    message: 'Compliant Aadhar number must be 12 digits'
  }),
  compliantAadharFront: z.string().min(1).optional(),
  compliantAadharBack: z.string().min(1).optional(),
  compliantContactPhone: z.string().min(1).optional().refine((val) => !val || phoneRegex.test(val), {
    message: 'Compliant phone number must be 10 digits'
  }),
  compliantPanNumber: panSchema.optional(),
  compliantPanImage: z.string().min(1).optional(),
  compliantBankAccountNumber: z.string().min(1).optional(),
  compliantBankIfsc: z.string().min(1).optional(),
  compliantBankName: z.string().min(1).optional(),
  compliantBankBranch: z.string().min(1).optional(),
  compliantBankPassbookImage: z.string().min(1).optional()
}).refine((data) => {
  const isCompliant = data.isCompliantSenior === true;
  if (!isCompliant) return true;
  return !!data.compliantContactPhone &&
    !!data.compliantAadharFront &&
    !!data.compliantAadharBack &&
    !!data.compliantPanImage &&
    !!data.compliantBankPassbookImage;
}, {
  message: 'Compliant documents are required when isCompliantSenior is true (contact + compliant images)'
});


