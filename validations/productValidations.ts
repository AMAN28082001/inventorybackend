import { z } from 'zod';

// Helper to transform empty strings to null
const emptyStringToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((val) => (val === '' ? null : val), schema);

export const createProductSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name must be less than 255 characters'),
  model: z.string().min(1, 'Model is required').max(255, 'Model must be less than 255 characters'),
  wattage: emptyStringToNull(z.string().max(50).nullable().optional()),
  category: z.string().min(1, 'Category is required').max(255, 'Category must be less than 255 characters'),
  /** Display/unit label from frontend; not persisted unless a DB column exists */
  unit: z.string().max(50).optional(),
  product_name: z.string().max(255).optional(),
  product_category: z.string().max(255).optional(),
  serial_numbers: z.string().optional(),
  default_price: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return undefined;
      const num = Number(val);
      return isNaN(num) ? undefined : num;
    },
    z.number().min(0).optional()
  ),
  selling_price: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return undefined;
      const num = Number(val);
      return isNaN(num) ? undefined : num;
    },
    z.number().min(0).optional()
  ),
  cost_price: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return undefined;
      const num = Number(val);
      return isNaN(num) ? undefined : num;
    },
    z.number().min(0).optional()
  ),
  serial_number_prices: z.string().optional(),
  quantity: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return 0;
      const num = Number(val);
      return isNaN(num) ? 0 : num;
    },
    z.number().int().min(0, 'Quantity cannot be negative')
  ).default(0),
  unit_price: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return null;
      const num = Number(val);
      return isNaN(num) ? null : num;
    },
    z.number().min(0, 'Unit price cannot be negative').nullable()
  ).optional(),
  image: z.string().nullable().optional()
});

export const updateProductSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  model: z.string().min(1).max(255).optional(),
  wattage: emptyStringToNull(z.string().max(50).nullable().optional()),
  category: z.string().min(1).max(255).optional(),
  unit: z.string().max(50).optional(),
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
  selling_price: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return undefined;
      const num = Number(val);
      return isNaN(num) ? undefined : num;
    },
    z.number().min(0).optional()
  ),
  stock_to_add: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return undefined;
      const num = Number(val);
      return isNaN(num) ? undefined : num;
    },
    z.number().int().min(0).optional()
  ),
  serial_numbers: z.string().optional(),
  default_price: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return undefined;
      const num = Number(val);
      return isNaN(num) ? undefined : num;
    },
    z.number().min(0).optional()
  ),
  cost_price: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return undefined;
      const num = Number(val);
      return isNaN(num) ? undefined : num;
    },
    z.number().min(0).optional()
  ),
  serial_number_prices: z.string().optional(),
  quantity: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return undefined;
      const num = Number(val);
      return isNaN(num) ? undefined : num;
    },
    z.number().int().min(0).optional()
  ),
  unit_price: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return null;
      const num = Number(val);
      return isNaN(num) ? null : num;
    },
    z.number().min(0).nullable().optional()
  ),
  image: z.string().nullable().optional()
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update'
});



