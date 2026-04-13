import { z } from 'zod';

const addressSchema = z.object({
  street: z.string().min(1, 'Street address is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  pincode: z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits')
});

export const createCustomerSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().trim().max(100).optional().nullable().default(''),
  mobile: z.string().regex(/^\d{10}$/, 'Mobile must be 10 digits'),
  email: z.string().trim().email('Invalid email format').optional().or(z.literal('')).nullable().default(''),
  address: addressSchema
});

export const updateCustomerSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().trim().max(100).optional().nullable().default(''),
  mobile: z.string().regex(/^\d{10}$/).optional(),
  email: z.string().trim().email('Invalid email format').optional().or(z.literal('')).nullable().default(''),
  address: addressSchema.optional()
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update'
});

