import { z } from 'zod';

export const updateStatusSchema = z
  .object({
    status: z.enum(['pending', 'approved', 'rejected', 'completed']),
    paymentType: z.enum(['loan', 'cash', 'mix']).optional(),
    paymentMode: z.enum(['loan', 'cash', 'mix']).optional(),
    bankName: z.string().optional(),
    bankIfsc: z.string().optional(),
    bank_ifsc: z.string().optional(),
    subsidyChequeDetails: z.string().optional(),
    subsidy_cheque_details: z.string().optional()
  })
  .refine(
    (data) => {
      if (data.status !== 'approved') return true;
      return !!(data.paymentType || data.paymentMode);
    },
    {
      message: 'paymentType is required when approving quotation',
      path: ['paymentType']
    }
  );

/** PATCH /admin/quotations/:id/file-login — body validated loosely; controller enforces rules. */
export const fileLoginSchema = z
  .object({
    resetFileLogin: z.boolean().optional(),
    fileLoginStatus: z.string().optional(),
    file_login_status: z.string().optional(),
    filePaymentType: z.enum(['loan', 'cash', 'mix']).optional(),
    file_payment_type: z.enum(['loan', 'cash', 'mix']).optional(),
    paymentMode: z.enum(['loan', 'cash', 'mix']).optional(),
    fileBankName: z.string().optional(),
    file_bank_name: z.string().optional(),
    bankName: z.string().optional(),
    fileBankIfsc: z.string().optional(),
    file_bank_ifsc: z.string().optional(),
    bankIfsc: z.string().optional(),
    bank_ifsc: z.string().optional(),
    fileSubsidyChequeDetails: z.string().optional(),
    file_subsidy_cheque_details: z.string().optional()
  })
  .passthrough();

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

