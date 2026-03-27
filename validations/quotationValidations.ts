import { z } from 'zod';
import { ALLOWED_PAYMENT_MODES, normalizePaymentModeInput } from '../utils/paymentMode';

const addressSchema = z.object({
  street: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  pincode: z.string().regex(/^\d{6}$/)
});

const customerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  mobile: z.string().regex(/^\d{10}$/),
  email: z.union([z.string().email(), z.literal('')]).optional(),
  address: addressSchema
});

const productsSchema = z.object({
  systemType: z.enum(['on-grid', 'off-grid', 'hybrid', 'dcr', 'non-dcr', 'both', 'customize']),
  phase: z.enum(['1-Phase', '3-Phase'], 'Phase must be 1-Phase or 3-Phase').optional(),
  panelBrand: z.string().nullish(),
  panelSize: z.string().nullish(),
  panelQuantity: z.number().int().positive().nullish(),
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
  centralSubsidy: z.number().nonnegative().default(0),
  stateSubsidy: z.number().nonnegative().default(0),
  customPanels: z.array(z.object({
    brand: z.string().min(1),
    size: z.string().min(1),
    quantity: z.number().int().positive(),
    type: z.enum(['dcr', 'non-dcr']),
    price: z.number().nonnegative()
  })).nullish()
});

const paymentModeEnum = z.enum(
  ['cash', 'upi', 'loan', 'netbanking', 'bank_transfer', 'cheque', 'card', 'mix'],
  { message: 'Invalid payment mode' }
);

const paymentStatusEnum = z.enum(['pending', 'partial', 'completed'], {
  message: 'Invalid payment status'
});

const booleanOrString = z.union([
  z.boolean(),
  z.string().transform((val) => {
    if (val.toLowerCase() === 'true') return true;
    if (val.toLowerCase() === 'false') return false;
    throw new Error('Invalid boolean');
  })
]);

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

export const createQuotationSchema = z.object({
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
  // Optional nested pricing object (for backward compatibility)
  pricing: z.object({
    subtotal: numberOrStringNumber.pipe(z.number().positive()).nullish(),
    totalAmount: numberOrStringNumber.pipe(z.number().nonnegative()).nullish(),
    finalAmount: numberOrStringNumber.pipe(z.number().nonnegative()).nullish(),
    centralSubsidy: numberOrStringNumber.pipe(z.number().nonnegative()).nullish(),
    stateSubsidy: numberOrStringNumber.pipe(z.number().nonnegative()).nullish(),
    totalSubsidy: numberOrStringNumber.pipe(z.number().nonnegative()).nullish(),
    amountAfterSubsidy: numberOrStringNumber.pipe(z.number().nonnegative()).nullish(),
    discountAmount: numberOrStringNumber.pipe(z.number().nonnegative()).nullish()
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
  });

export const updateDiscountSchema = z.object({
  discount: numberOrStringNumber.pipe(z.number().min(0).max(100)).optional(),
  discountAmount: numberOrStringNumber.pipe(z.number().nonnegative()).optional()
}).refine((data) => data.discount !== undefined || data.discountAmount !== undefined, {
  message: 'Either discount or discountAmount must be provided'
});

export const updateProductsSchema = z.object({
  products: productsSchema.partial().refine((val) => {
    if (val.systemType === 'customize') {
      return Array.isArray(val.customPanels) && val.customPanels.length > 0;
    }
    return true;
  }, {
    message: 'customPanels is required when systemType is customize'
  })
}).refine((data) => Object.keys(data.products || {}).length > 0, {
  message: 'At least one products field must be provided'
});

export const updatePricingSchema = z.object({
  subtotal: z.number().nonnegative().optional(),
  stateSubsidy: z.number().nonnegative().optional(),
  centralSubsidy: z.number().nonnegative().optional(),
  discount: numberOrStringNumber.pipe(z.number().min(0).max(100)).optional(),
  discountAmount: numberOrStringNumber.pipe(z.number().nonnegative()).optional(),
  finalAmount: z.number().nonnegative().optional(),
  paymentMode: paymentModeEnum.optional(),
  paidAmount: numberOrStringNumber.pipe(z.number().nonnegative()).optional(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Payment date must be in YYYY-MM-DD format').optional(),
  paymentStatus: paymentStatusEnum.optional()
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
  transaction_id: z.union([z.string(), z.null()]).optional()
});

const resolvePhasePaid = (p: z.infer<typeof rawPaymentPhaseSchema>): number =>
  Number(p.paidAmount ?? p.paid_amount ?? p.paidAmt ?? p.paid ?? 0);

export const updatePaymentDetailsSchema = z
  .object({
    paymentType: z.enum(['loan', 'cash', 'mix']).optional(),
    paymentMode: z.union([z.string(), z.null()]).optional(),
    paymentStatus: paymentStatusEnum.optional(),
    phases: z.array(rawPaymentPhaseSchema).optional(),
    installments: z.array(rawPaymentPhaseSchema).optional(),
    paymentPhases: z.array(rawPaymentPhaseSchema).optional()
  })
  .refine(
    (data) =>
      Array.isArray(data.phases) ||
      Array.isArray(data.installments) ||
      Array.isArray(data.paymentPhases),
    {
      message: 'phases (or installments/paymentPhases) is required',
      path: ['phases']
    }
  )
  .transform((data) => {
    const rawList =
      data.phases ?? data.installments ?? data.paymentPhases ?? [];
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
            : String(rawTid)
      };
    });
    return {
      paymentType: data.paymentType,
      paymentMode: topMode,
      paymentStatus: data.paymentStatus,
      phases
    };
  })
  .superRefine((data, ctx) => {
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

export const updatePaymentModeSchema = z.object({
  paymentMode: z
    .union([z.string(), z.null()])
    .transform((v) => normalizePaymentModeInput(v))
    .refine((v) => v !== undefined, { message: 'Invalid or missing payment mode' })
});

const aadharRegex = /^\d{12}$/;
const phoneRegex = /^\d{10}$/;
const panRegex = /^[A-Z]{5}\d{4}[A-Z]$/;

const panSchema = z
  .string()
  .min(1)
  .transform((val) => val.toUpperCase())
  .refine((val) => panRegex.test(val), { message: 'PAN must be in format ABCDE1234F' });

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
  return !!data.compliantAadharNumber &&
    !!data.compliantContactPhone &&
    !!data.compliantAadharFront &&
    !!data.compliantAadharBack &&
    !!data.compliantPanNumber &&
    !!data.compliantPanImage &&
    !!data.compliantBankAccountNumber &&
    !!data.compliantBankIfsc &&
    !!data.compliantBankName &&
    !!data.compliantBankBranch &&
    !!data.compliantBankPassbookImage;
}, {
  message: 'Compliant documents are required when isCompliantSenior is true'
});


