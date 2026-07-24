import { z } from 'zod';

export const uploadCallingLeadsSchema = z.object({
  dealerIds: z.preprocess((value) => {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null || value === '') return [];
    return [value];
  }, z.array(z.string().min(1)).min(1, 'dealerIds[] cannot be empty')),
  activeLimitPerDealer: z.preprocess((value) => {
    if (value !== undefined && value !== null && value !== '') return value;
    return undefined;
  }, z.coerce.number().int().min(1).max(50).optional()),
  activeLeadsLimit: z.preprocess((value) => {
    if (value !== undefined && value !== null && value !== '') return value;
    return undefined;
  }, z.coerce.number().int().min(1).max(50).optional()),
  /** §15-C — round_robin_all assigns every row (ignore active cap leftovers) */
  assignmentMode: z.string().max(64).optional(),
  assignment_mode: z.string().max(64).optional(),
  mode: z.string().max(64).optional()
});

export const assignUnassignedLeadsSchema = z
  .object({
    assignmentMode: z.string().max(64).optional(),
    assignment_mode: z.string().max(64).optional(),
    dealerIds: z.preprocess((value) => {
      if (value === undefined || value === null || value === '') return undefined;
      if (Array.isArray(value)) return value;
      return [value];
    }, z.array(z.string().min(1)).optional())
  })
  .passthrough();

const ALLOWED_STATUS_CATEGORIES = [
  'call_connectivity',
  'lead_validity',
  'customer_intent',
  'financial',
  'competition',
  'schedule',
  'other',
  'part_1_call_and_lead',
  'part_2_interest_and_qualification',
  'part_3_follow_up_and_sales',
  'part_4_rejection_lost'
] as const;

const parseFollowUpDate = (raw: unknown): Date | null => {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const dealerLeadActionSchema = z
  .object({
    action: z.enum(['start', 'called', 'follow_up', 'not_interested', 'rescheduled']),
    callRemark: z.string().max(5000).optional(),
    call_remark: z.string().max(5000).optional(),
    /** Explicit history edit (PATCH) — relax assignment transition guards for completed rows */
    editMode: z.coerce.boolean().optional(),
    /** API / contract aliases (snake_case) */
    status_category: z.string().max(64).optional(),
    status_text: z.string().max(128).optional(),
    statusText: z.string().max(128).optional(),
    remark: z.string().max(4000).optional(),
    statusCategory: z.enum(ALLOWED_STATUS_CATEGORIES).optional(),
    statusCategoryKey: z.enum(ALLOWED_STATUS_CATEGORIES).optional(),
    statusLabel: z.string().max(128).optional(),
    statusCategoryLabel: z.string().max(128).optional(),
    statusReason: z.string().max(255).optional(),
    isCustomReason: z.boolean().optional(),
    nextFollowUpAt: z.string().max(64).optional(),
    next_follow_up_at: z.string().max(64).optional(),
    actionAt: z.string().max(64).optional()
  })
  .passthrough()
  .transform((value) => {
    const nextFollowUpAt =
      String(value.nextFollowUpAt ?? value.next_follow_up_at ?? '').trim() || undefined;
    const action =
      value.action === 'follow_up' && nextFollowUpAt ? 'rescheduled' : value.action;
    return { ...value, action, nextFollowUpAt };
  })
  .superRefine((value, ctx) => {
    if (value.action === 'rescheduled') {
      if (!value.nextFollowUpAt) {
        ctx.addIssue({
          code: 'custom',
          path: ['nextFollowUpAt'],
          message: 'nextFollowUpAt is required when action is rescheduled'
        });
        return;
      }
      const followUpDate = parseFollowUpDate(value.nextFollowUpAt);
      if (!followUpDate) {
        ctx.addIssue({
          code: 'custom',
          path: ['nextFollowUpAt'],
          message: 'Invalid datetime format'
        });
        return;
      }
      if (followUpDate.getTime() <= Date.now()) {
        ctx.addIssue({
          code: 'custom',
          path: ['nextFollowUpAt'],
          message: 'nextFollowUpAt must be a future datetime when action is rescheduled'
        });
      }
    }

    const customMode = value.isCustomReason === true || value.statusReason === 'Others';
    if (customMode) {
      const remark = String(value.callRemark ?? value.call_remark ?? '').trim();
      if (!remark) {
        ctx.addIssue({
          code: 'custom',
          path: ['callRemark'],
          message: 'Manual reason is required when statusReason is Others or custom mode is used'
        });
      }
    }

    const cat = value.statusCategory || value.statusCategoryKey || value.status_category;
    if (cat && !ALLOWED_STATUS_CATEGORIES.includes(cat as (typeof ALLOWED_STATUS_CATEGORIES)[number])) {
      ctx.addIssue({
        code: 'custom',
        path: ['statusCategoryKey'],
        message: 'Invalid status category value'
      });
    }
  });
