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
  }, z.coerce.number().int().min(1).max(50).optional())
});

export const dealerLeadActionSchema = z
  .object({
  action: z.enum(['start', 'called', 'follow_up', 'not_interested', 'rescheduled']),
  callRemark: z.string().max(5000).optional(),
  /** Explicit history edit (PATCH) — relax assignment transition guards for completed rows */
  editMode: z.coerce.boolean().optional(),
  /** API / contract aliases (snake_case) */
  status_category: z.string().max(64).optional(),
  status_text: z.string().max(128).optional(),
  statusCategory: z.enum([
    'call_connectivity',
    'lead_validity',
    'customer_intent',
    'financial',
    'competition',
    'schedule',
    'other'
  ]).optional(),
  statusCategoryKey: z.enum([
    'call_connectivity',
    'lead_validity',
    'customer_intent',
    'financial',
    'competition',
    'schedule',
    'other'
  ]).optional(),
  statusLabel: z.string().max(128).optional(),
  statusCategoryLabel: z.string().max(128).optional(),
  statusReason: z.string().max(255).optional(),
  isCustomReason: z.boolean().optional(),
  nextFollowUpAt: z.string().datetime().optional(),
  actionAt: z.string().datetime().optional()
})
  .passthrough()
  .refine((value) => {
  if (value.action === 'rescheduled') {
    return !!value.nextFollowUpAt;
  }
  return true;
}, {
  message: 'nextFollowUpAt is required when action is rescheduled',
  path: ['nextFollowUpAt']
}).refine((value) => {
  if (value.action !== 'rescheduled' || !value.nextFollowUpAt) return true;
  return new Date(value.nextFollowUpAt).getTime() > Date.now();
}, {
  message: 'nextFollowUpAt must be a future datetime when action is rescheduled',
  path: ['nextFollowUpAt']
}).refine((value) => {
  const customMode = value.isCustomReason === true || value.statusReason === 'Others';
  if (!customMode) return true;
  return !!value.callRemark && value.callRemark.trim().length > 0;
}, {
  message: 'Manual reason is required when statusReason is Others or custom mode is used',
  path: ['callRemark']
}).refine((value) => {
  const cat = value.statusCategory || value.statusCategoryKey || value.status_category;
  if (!cat) return true;
  return ([
    'call_connectivity',
    'lead_validity',
    'customer_intent',
    'financial',
    'competition',
    'schedule',
    'other'
  ] as const).includes(cat as any);
}, {
  message: 'Invalid status category value',
  path: ['statusCategoryKey']
});
