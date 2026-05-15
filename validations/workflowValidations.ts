import { z } from 'zod';

const installerDocType = z.enum(['installer_po', 'installer_pi', 'additional_expense', 'site_completion_image']);
const baldevDocType = z.enum(['warranty_doc', 'meter_doc', 'other']);
const decisionAction = z.enum(['approve', 'reject']);
const installerStatusAction = z.enum(['start', 'approve', 'reject']);

export const installerStatusSchema = z.object({
  action: installerStatusAction,
  remarks: z.string().max(5000).optional()
});

// Backward compatibility for older frontend path naming.
export const installerDecisionSchema = installerStatusSchema;

export const baldevDecisionSchema = z.object({
  action: decisionAction,
  remarks: z.string().max(5000).optional(),
  markCompleted: z.boolean().optional()
});

export const installerUploadMetaSchema = z
  .object({
    docType: installerDocType.optional(),
    siteLength: z.string().max(32).optional(),
    siteWidth: z.string().max(32).optional(),
    siteHeight: z.string().max(32).optional(),
    backLegCm: z.string().max(32).optional(),
    midLegCm: z.string().max(32).optional(),
    frontLegCm: z.string().max(32).optional(),
    backLegFeet: z.string().max(32).optional(),
    midLegFeet: z.string().max(32).optional(),
    frontLegFeet: z.string().max(32).optional(),
    extraExpensesJson: z.string().max(500000).optional(),
    extraExpensesTotal: z.string().max(32).optional(),
    installationStatus: z.string().max(64).optional(),
    installerRemarks: z.string().max(5000).optional(),
    remarks: z.string().max(5000).optional(),
    /** JSON array of logical keys aligned with repeated `installerCompletionImages` file parts (admin aggregate upload). */
    installerCompletionImageFieldOrderJson: z.string().max(50000).optional()
  })
  .passthrough();

export const baldevUploadMetaSchema = z.object({
  docType: baldevDocType,
  remarks: z.string().max(5000).optional()
});


const meteringAction = z.enum(['start', 'approve', 'send_to_mco', 'mark_completed', 'move_back']);

/** Action-based updates, or direct installationStatus for gateway/legacy clients (see BACKEND_CHANGES_REQUIRED.md). */
export const meteringStatusSchema = z
  .object({
    action: meteringAction.optional(),
    remarks: z.string().max(5000).optional(),
    installationStatus: z.string().max(64).optional(),
    installation_status: z.string().max(64).optional(),
    meteringStatus: z.string().max(64).optional(),
    status: z.string().max(64).optional()
  })
  .refine(
    (d) =>
      d.action !== undefined ||
      Boolean(d.installationStatus || d.installation_status || d.meteringStatus || d.status),
    { message: 'Provide action or one of installationStatus, installation_status, meteringStatus, status' }
  );

export const meteringDetailsSchema = z.object({
  discomName: z.string().max(255).optional(),
  meterType: z.enum(['solar', 'net', 'both']).optional(),
  meterNo: z.string().max(120).optional(),
  solarMeterNo: z.string().max(120).optional(),
  netMeterNo: z.string().max(120).optional()
}).passthrough();

export const meteringMcoDocumentsSchema = z
  .object({
    remarks: z.string().max(5000).optional()
  })
  .passthrough();
