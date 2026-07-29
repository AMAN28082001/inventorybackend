import { z } from 'zod';

const addressSchema = z.object({
  id: z.string().optional(),
  line1: z.string().min(1, 'Address line1 is required').optional(),
  line2: z.string().nullable().optional(),
  city: z.string().min(1, 'City is required').optional(),
  state: z.string().min(1, 'State is required').optional(),
  postal_code: z.string().min(1, 'Postal code is required').optional(),
  country: z.string().min(1, 'Country is required').optional()
});

export const createSaleSchema = z.object({
  type: z.enum(['B2B', 'B2C'], 'Type must be B2B or B2C'),
  customer_name: z.string().min(1, 'Customer name is required'),
  items: z.preprocess((val) => {
    if (val === '' || val === null) {
      return undefined;
    }
    if (Array.isArray(val)) {
      return val;
    }
    if (val && typeof val === 'object') {
      const values = Object.values(val as Record<string, unknown>);
      if (values.length && values.every((entry) => entry && typeof entry === 'object')) {
        return values;
      }
      return [val];
    }
    return val;
  }, z.any()).optional(),
  product_id: z.string().optional(), // Legacy support
  product_name: z.string().optional(), // Legacy support
  model: z.string().optional(), // Legacy support
  quantity: z.coerce.number().positive('Quantity must be greater than 0').optional(), // Legacy support
  unit_price: z.coerce.number().min(0).optional(), // Legacy support
  line_total: z.coerce.number().min(0).optional(), // Legacy support
  product_summary: z.string().optional(),
  subtotal: z.coerce.number().min(0).optional(),
  tax_amount: z.coerce.number().min(0).optional(),
  discount_amount: z.coerce.number().min(0).optional(),
  payment_status: z.enum(['pending', 'completed']).optional(),
  sale_date: z.string().datetime().or(z.date()).optional(),
  company_name: z.string().nullable().optional(),
  gst_number: z.string().nullable().optional(),
  contact_person: z.string().nullable().optional(),
  billing_address_id: z.string().nullable().optional(),
  billing_address: addressSchema.nullable().optional(),
  delivery_address_id: z.string().nullable().optional(),
  delivery_address: addressSchema.nullable().optional(),
  delivery_matches_billing: z.boolean().or(z.string()).optional(),
  customer_email: z.string().email().nullable().optional(),
  customer_phone: z.string().nullable().optional(),
  delivery_instructions: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  // Agent / Quotation Admin — sell from a specific admin warehouse (§21)
  admin_id: z.string().optional(),
  adminId: z.string().optional(),
  sell_from_admin_id: z.string().optional(),
  stock_admin_id: z.string().optional(),
  stock_source: z.string().optional(),
  use_admin_stock: z.union([z.boolean(), z.string(), z.number()]).optional(),
  created_by: z.string().optional(),
  createdBy: z.string().optional(),
  created_by_id: z.string().optional(),
  createdById: z.string().optional(),
  serial_numbers: z.any().optional()
}).passthrough().refine((data) => {
  // Either items array/string is provided, or legacy single-item fields are provided
  return data.items !== undefined || (data.product_id !== undefined || (data.product_name !== undefined && data.model !== undefined));
}, {
  message: 'Either items array or product_id (or product_name and model) must be provided'
});

export const updateSaleSchema = z.object({
  items: z.preprocess((val) => {
    if (val === '' || val === null) return undefined;
    if (Array.isArray(val)) return val;
    if (val && typeof val === 'object') {
      const values = Object.values(val as Record<string, unknown>);
      if (values.length && values.every((entry) => entry && typeof entry === 'object')) {
        return values;
      }
      return [val];
    }
    return val;
  }, z.any()).optional(),
  customer_name: z.string().min(1).optional(),
  payment_status: z.enum(['pending', 'completed']).optional(),
  approval_status: z.enum(['pending', 'approved']).optional(),
  subtotal: z.coerce.number().min(0).optional(),
  tax_amount: z.coerce.number().min(0).optional(),
  discount_amount: z.coerce.number().min(0).optional(),
  total_amount: z.coerce.number().min(0).optional(),
  product_summary: z.string().optional(),
  company_name: z.string().nullable().optional(),
  gst_number: z.string().nullable().optional(),
  contact_person: z.string().nullable().optional(),
  billing_address_id: z.string().nullable().optional(),
  billing_address: addressSchema.nullable().optional(),
  delivery_address_id: z.string().nullable().optional(),
  delivery_address: addressSchema.nullable().optional(),
  delivery_matches_billing: z.boolean().or(z.string()).optional(),
  customer_email: z.string().email().nullable().optional(),
  customer_phone: z.string().nullable().optional(),
  delivery_instructions: z.string().nullable().optional(),
  notes: z.string().nullable().optional()
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update'
});

