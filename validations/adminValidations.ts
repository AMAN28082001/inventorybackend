import { z } from 'zod';
import { workflowPermissionFieldsSchema } from './workflowPermissionValidations';

export const updateStatusSchema = z
  .object({
    status: z.enum(['pending', 'approved', 'rejected', 'completed']),
    statusApprovedAt: z.string().optional(),
    status_approved_at: z.string().optional(),
    approvedAt: z.string().optional(),
    approved_at: z.string().optional(),
    paymentType: z.enum(['loan', 'cash', 'mix']).optional(),
    paymentMode: z.enum(['loan', 'cash', 'mix']).optional(),
    loanAmount: z.union([z.number(), z.string()]).optional(),
    loan_amount: z.union([z.number(), z.string()]).optional(),
    cashAmount: z.union([z.number(), z.string()]).optional(),
    cash_amount: z.union([z.number(), z.string()]).optional(),
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
  metering_wcc_after_discom: z.union([z.boolean(), z.string(), z.number()]).optional(),
  // Admin Send to Metering override flags (Jul 2026 — lib/api.ts → sendQuotationToMetering)
  force: z.union([z.boolean(), z.string(), z.number()]).optional(),
  adminOverride: z.union([z.boolean(), z.string(), z.number()]).optional(),
  allowFromPendingInstaller: z.union([z.boolean(), z.string(), z.number()]).optional(),
  allowRevert: z.union([z.boolean(), z.string(), z.number()]).optional(),
  source: z.string().optional(),
  installerApprovedAt: z.any().optional(),
  installer_approved_at: z.any().optional(),
  installationPartialApproved: z.union([z.boolean(), z.string(), z.number()]).optional(),
  installation_partial_approved: z.union([z.boolean(), z.string(), z.number()]).optional()
}).passthrough().refine((data) => {
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

/**
 * PATCH|POST /admin/quotations/:id/send-to-metering
 * Body is optional — empty body still means "send to pending_metering".
 */
export const sendToMeteringSchema = z
  .object({
    installationStatus: installationStatusEnum.optional(),
    installation_status: installationStatusEnum.optional(),
    meteringStatus: installationStatusEnum.optional(),
    metering_status: installationStatusEnum.optional(),
    status: installationStatusEnum.optional(),
    force: z.union([z.boolean(), z.string(), z.number()]).optional(),
    adminOverride: z.union([z.boolean(), z.string(), z.number()]).optional(),
    allowFromPendingInstaller: z.union([z.boolean(), z.string(), z.number()]).optional(),
    source: z.string().optional(),
    remarks: z.string().max(5000).optional()
  })
  .passthrough();

/** PATCH|POST /admin/quotations/:id/retrieve-from-metering */
export const retrieveFromMeteringSchema = z
  .object({
    installationStatus: installationStatusEnum.optional(),
    installation_status: installationStatusEnum.optional(),
    target: z.string().optional(),
    retrieveFromMetering: z.union([z.boolean(), z.string(), z.number()]).optional(),
    allowRevert: z.union([z.boolean(), z.string(), z.number()]).optional(),
    force: z.union([z.boolean(), z.string(), z.number()]).optional(),
    adminOverride: z.union([z.boolean(), z.string(), z.number()]).optional(),
    source: z.string().optional()
  })
  .passthrough();

/** PATCH|POST /admin/quotations/:id/retrieve-from-installation */
export const retrieveFromInstallationSchema = z
  .object({
    installationReadyForInstaller: z.union([z.boolean(), z.string(), z.number()]).optional(),
    installation_ready_for_installer: z.union([z.boolean(), z.string(), z.number()]).optional(),
    installationReleasedAt: z.union([z.string(), z.date(), z.null()]).optional(),
    installation_released_at: z.union([z.string(), z.date(), z.null()]).optional(),
    retrieveFromInstallation: z.union([z.boolean(), z.string(), z.number()]).optional(),
    allowRevert: z.union([z.boolean(), z.string(), z.number()]).optional(),
    force: z.union([z.boolean(), z.string(), z.number()]).optional(),
    adminOverride: z.union([z.boolean(), z.string(), z.number()]).optional(),
    source: z.string().optional()
  })
  .passthrough();

/** PATCH /admin/quotations/:id/metering-wcc-after-discom */
export const meteringWccAfterDiscomSchema = z
  .object({
    meteringWccAfterDiscom: z.union([z.boolean(), z.string(), z.number()]).optional(),
    metering_wcc_after_discom: z.union([z.boolean(), z.string(), z.number()]).optional()
  })
  .passthrough()
  .refine(
    (data) =>
      data.meteringWccAfterDiscom !== undefined || data.metering_wcc_after_discom !== undefined,
    {
      message: 'meteringWccAfterDiscom is required',
      path: ['meteringWccAfterDiscom']
    }
  );

/** §17 Bank process dual-track */
export const bankProcessSchema = z
  .object({
    bankName: z.string().max(255).optional(),
    bank_name: z.string().max(255).optional(),
    bankIfsc: z.string().max(32).optional(),
    bank_ifsc: z.string().max(32).optional(),
    loanAmount: z.union([z.number(), z.string()]).optional(),
    loan_amount: z.union([z.number(), z.string()]).optional(),
    paymentType: z.string().max(32).optional(),
    payment_type: z.string().max(32).optional(),
    paymentMode: z.string().max(32).optional(),
    payment_mode: z.string().max(32).optional(),
    bankProcessDone: z.union([z.boolean(), z.string(), z.number()]).optional(),
    bank_process_done: z.union([z.boolean(), z.string(), z.number()]).optional(),
    moveToPendingPayment: z.union([z.boolean(), z.string(), z.number()]).optional(),
    move_to_pending_payment: z.union([z.boolean(), z.string(), z.number()]).optional()
  })
  .passthrough();

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
  employeeId: z.string().optional().nullable(),
  gender: z.enum(['Male', 'Female', 'Other']).optional(),
  dateOfBirth: z.string().optional(),
  fatherName: z.string().optional(),
  fatherContact: z.string().optional(),
  governmentIdType: z.string().optional(),
  governmentIdNumber: z.string().optional(),
  address: z
    .object({
      street: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      pincode: z.string().optional()
    })
    .optional(),
  access: z.array(z.string()).optional(),
  permissions: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  emailVerified: z.boolean().optional(),
  ...workflowPermissionFieldsSchema
});

export const updateVisitorSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  mobile: z.string().regex(/^\d{10}$/).optional(),
  employeeId: z.string().optional().nullable(),
  gender: z.enum(['Male', 'Female', 'Other']).optional(),
  dateOfBirth: z.string().optional(),
  fatherName: z.string().optional(),
  fatherContact: z.string().optional(),
  governmentIdType: z.string().optional(),
  governmentIdNumber: z.string().optional(),
  address: z
    .object({
      street: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      pincode: z.string().optional()
    })
    .optional(),
  access: z.array(z.string()).optional(),
  permissions: z.array(z.string()).optional(),
  password: z.union([z.string().min(6), z.literal('')]).optional(),
  isActive: z.boolean().optional(),
  emailVerified: z.boolean().optional(),
  ...workflowPermissionFieldsSchema
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

