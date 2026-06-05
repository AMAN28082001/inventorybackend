import { z } from 'zod';

const statusEnum = z.enum(['new', 'in_progress', 'completed', 'rejected']);

export const createDealerRequestSchema = z.object({
  customerName: z.string().min(1, 'Customer name is required').max(150),
  phoneNumber: z.string().min(7).max(20),
  email: z.string().email().optional().or(z.literal('')),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  address: z.string().max(2000).optional(),
  message: z.string().max(5000).optional(),
  source: z.string().max(100).optional()
});

export const updateDealerRequestSchema = z.object({
  status: statusEnum.optional(),
  assignedDealerId: z.string().min(1).nullable().optional(),
  actionRemark: z.string().max(5000).nullable().optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  address: z.string().max(2000).optional(),
  message: z.string().max(5000).optional()
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided'
});

export const setDefaultDealerSchema = z.object({
  dealerId: z.string().min(1, 'dealerId is required')
});
