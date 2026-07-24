import { z } from 'zod';
import { isAllowedProductUnit, normalizeProductUnit, roundProductPrice } from '../utils/productUnit';

// Helper to transform empty strings to null
const emptyStringToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((val) => (val === '' ? null : val), schema);

const optionalProductUnitSchema = z
  .string()
  .max(50)
  .optional()
  .refine((val) => val === undefined || isAllowedProductUnit(val), {
    message: 'unit must be a supported display name or code (Pieces, PCS, Kilograms, KGS, Meters, MTR, Quantity, NOS, Watts, W, Pack, PAC, Fixed, Pillar)'
  })
  .transform((val) => (val === undefined ? undefined : normalizeProductUnit(val) ?? undefined));

const optionalDecimalPriceSchema = z.preprocess(
  (val) => {
    if (val === undefined) return undefined;
    return roundProductPrice(val);
  },
  z.number().min(0).nullable().optional()
);

const optionalNullableDecimalPriceSchema = z.preprocess(
  (val) => {
    if (val === undefined) return undefined;
    if (val === '' || val === null) return null;
    return roundProductPrice(val);
  },
  z.number().min(0, 'Unit price cannot be negative').nullable().optional()
);

export const createProductSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name must be less than 255 characters'),
  model: z.string().min(1, 'Model is required').max(255, 'Model must be less than 255 characters'),
  wattage: emptyStringToNull(z.string().max(50).nullable().optional()),
  category: z.string().min(1, 'Category is required').max(255, 'Category must be less than 255 characters'),
  /** Display name or code; persisted on products.unit (kg→pieces sends "Pieces"). */
  unit: optionalProductUnitSchema,
  product_name: z.string().max(255).optional(),
  product_category: z.string().max(255).optional(),
  serial_numbers: z.union([z.string(), z.array(z.string())]).optional(),
  default_price: optionalDecimalPriceSchema,
  selling_price: optionalDecimalPriceSchema,
  cost_price: optionalDecimalPriceSchema,
  serial_number_prices: z.union([z.string(), z.record(z.string(), z.union([z.string(), z.number()]))]).optional(),
  quantity: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return 0;
      const num = Number(val);
      return isNaN(num) ? 0 : num;
    },
    z.number().int().min(0, 'Quantity cannot be negative')
  ).default(0),
  unit_price: optionalNullableDecimalPriceSchema,
  image: z.string().nullable().optional(),
  /** Inventory users.id — used when quotation Admin JWT is not in `users` yet */
  created_by: z.string().max(50).optional(),
  createdBy: z.string().max(50).optional()
});

export const updateProductSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  model: z.string().min(1).max(255).optional(),
  wattage: emptyStringToNull(z.string().max(50).nullable().optional()),
  category: z.string().min(1).max(255).optional(),
  unit: optionalProductUnitSchema,
  product_name: z.string().max(255).optional(),
  product_category: z.string().max(255).optional(),
  use_max_cost_price: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return undefined;
      if (typeof val === 'boolean') return val;
      if (val === 'true') return true;
      if (val === 'false') return false;
      return undefined;
    },
    z.boolean().optional()
  ),
  selling_price: optionalDecimalPriceSchema,
  stock_to_add: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return undefined;
      const num = Number(val);
      return isNaN(num) ? undefined : num;
    },
    z
      .number()
      .int('stock_to_add must be a whole number (pieces)')
      .min(0)
      .optional()
  ),
  serial_numbers: z.union([z.string(), z.array(z.string())]).optional(),
  default_price: optionalDecimalPriceSchema,
  cost_price: optionalDecimalPriceSchema,
  serial_number_prices: z.union([z.string(), z.record(z.string(), z.union([z.string(), z.number()]))]).optional(),
  quantity: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return undefined;
      const num = Number(val);
      return isNaN(num) ? undefined : num;
    },
    z.number().int().min(0).optional()
  ),
  unit_price: optionalNullableDecimalPriceSchema,
  image: z.string().nullable().optional()
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update'
});



