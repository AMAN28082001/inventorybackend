import { z } from 'zod';

export const updateStatusSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'completed']),
  paymentType: z.enum(['loan', 'cash', 'mix']).optional(),
  paymentMode: z.enum(['loan', 'cash', 'mix']).optional()
}).refine((data) => {
  if (data.status !== 'approved') return true;
  return !!(data.paymentType || data.paymentMode);
}, {
  message: 'paymentType is required when approving quotation',
  path: ['paymentType']
});

export const createVisitorSchema = z.object({
  username: z.string().min(1, 'Username is required').max(50),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  email: z.string().email('Invalid email format'),
  mobile: z.string().regex(/^\d{10}$/, 'Mobile must be 10 digits'),
  employeeId: z.string().optional()
});

export const updateVisitorSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  mobile: z.string().regex(/^\d{10}$/).optional(),
  employeeId: z.string().optional(),
  isActive: z.boolean().optional()
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update'
});

export const updateVisitorPasswordSchema = z.object({
  newPassword: z.string().min(6, 'Password must be at least 6 characters long')
});

