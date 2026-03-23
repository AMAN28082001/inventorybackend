import { z } from 'zod';

const installerDocType = z.enum(['installer_po', 'additional_expense', 'site_completion_image']);
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

export const installerUploadMetaSchema = z.object({
  docType: installerDocType,
  remarks: z.string().max(5000).optional()
});

export const baldevUploadMetaSchema = z.object({
  docType: baldevDocType,
  remarks: z.string().max(5000).optional()
});
