import { z } from 'zod';

const stockRequestItemSchema = z.object({
  product_id: z.string().optional(),
  product_name: z.string().optional(),
  model: z.string().optional(),
  quantity: z.coerce.number().int().positive('Quantity must be greater than 0')
}).refine((data) => {
  const hasProductId = data.product_id && typeof data.product_id === 'string' && data.product_id.trim().length > 0;
  const hasProductName = data.product_name && typeof data.product_name === 'string' && data.product_name.trim().length > 0;
  const hasModel = data.model && typeof data.model === 'string' && data.model.trim().length > 0;
  if (hasProductId) return true;
  return Boolean(hasProductName && hasModel);
}, {
  message: 'Either product_id or both product_name and model must be provided'
});

export const createStockRequestSchema = z.object({
  items: z.union([
    z.array(stockRequestItemSchema).min(1, 'At least one item is required'),
    z.string() // Allow string for JSON parsing
  ]).optional(),
  product_id: z.string().optional(), // Legacy support
  product_name: z.string().optional(), // Legacy support
  model: z.string().optional(), // Legacy support
  quantity: z.coerce.number().int().positive().optional(), // Legacy support
  requested_from: z.string().min(1, 'Requested from is required'),
  notes: z.string().nullable().optional(),
  status: z.string().optional()
}).refine((data) => {
  // Either items array/string is provided, or legacy single-item fields are provided
  return data.items !== undefined || (data.product_id !== undefined || (data.product_name !== undefined && data.model !== undefined));
}, {
  message: 'Either items array or product_id (or product_name and model) must be provided'
});

export const updateStockRequestSchema = z.object({
  items: z.union([
    z.array(stockRequestItemSchema).min(1),
    z.string()
  ]).optional(),
  notes: z.string().nullable().optional()
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update'
});
