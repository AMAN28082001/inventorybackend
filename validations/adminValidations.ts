import { z } from 'zod';

export const updateStatusSchema = z
  .object({
    status: z.enum(['pending', 'approved', 'rejected', 'completed']),
    statusApprovedAt: z.string().optional(),
    status_approved_at: z.string().optional(),
    approvedAt: z.string().optional(),
    approved_at: z.string().optional(),
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

const installationStatusEnum = z.enum([
  'pending_installer',
  'installer_in_progress',
  'installer_partial_approved',
  'installer_approved',
  'installer_rejected',
  'pending_baldev',
  'baldev_approved',
  'baldev_rejected',
  'pending_metering',
  'metering_in_progress',
  'metering_approved',
  'meter_installation_pending',
  'meter_install_pending',
  'mco',
  'completed'
]);

export const updateInstallationStatusSchema = z.object({
  installationStatus: installationStatusEnum.optional(),
  installation_status: installationStatusEnum.optional(),
  meteringStatus: installationStatusEnum.optional(),
  metering_status: installationStatusEnum.optional(),
  status: installationStatusEnum.optional(),
  remarks: z.string().max(5000).optional(),
  // Post-Discom WCC Pending queue flag (§L.2)
  meteringWccAfterDiscom: z.union([z.boolean(), z.string(), z.number()]).optional(),
  metering_wcc_after_discom: z.union([z.boolean(), z.string(), z.number()]).optional()
}).refine((data) => {
  const hasStatus = Boolean(
    data.installationStatus ||
      data.installation_status ||
      data.meteringStatus ||
      data.metering_status ||
      data.status
  );
  const hasWccFlag =
    data.meteringWccAfterDiscom !== undefined || data.metering_wcc_after_discom !== undefined;
  return hasStatus || hasWccFlag;
}, {
  message:
    'One of installationStatus / meteringStatus / status, or meteringWccAfterDiscom, is required'
});

/** PATCH /admin/quotations/:id/metering-wcc-after-discom */
export const meteringWccAfterDiscomSchema = z
  .object({
    meteringWccAfterDiscom: z.union([z.boolean(), z.string(), z.number()]).optional(),
    metering_wcc_after_discom: z.union([z.boolean(), z.string(), z.number()]).optional()
  })
  .refine(
    (data) =>
      data.meteringWccAfterDiscom !== undefined || data.metering_wcc_after_discom !== undefined,
    {
      message: 'meteringWccAfterDiscom is required',
      path: ['meteringWccAfterDiscom']
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

export const createInstallationTeamSchema = z.object({
  name: z.string().min(1).max(255),
  username: z.string().min(2).max(50),
  password: z.string().min(6).max(200)
});

export const patchInstallationTeamSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    username: z.string().min(2).max(50).optional(),
    password: z.string().min(6).max(200).optional(),
    isActive: z.boolean().optional()
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required'
  });

export const patchQuotationInstallationTeamSchema = z
  .object({
    installationTeamId: z.union([z.string().max(50), z.null()]).optional(),
    installation_team_id: z.union([z.string().max(50), z.null()]).optional()
  })
  .refine(
    (data) =>
      Object.prototype.hasOwnProperty.call(data, 'installationTeamId') ||
      Object.prototype.hasOwnProperty.call(data, 'installation_team_id'),
    { message: 'installationTeamId or installation_team_id is required' }
  );

export const patchInstallationTeamPasswordSchema = z
  .object({
    newPassword: z.string().min(6).max(200).optional(),
    password: z.string().min(6).max(200).optional()
  })
  .refine((data) => Boolean(data.newPassword || data.password), {
    message: 'newPassword or password is required'
  });

