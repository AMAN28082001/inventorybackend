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

export const dealerLeadActionSchema = z.object({
  action: z.enum(['start', 'called', 'follow_up', 'not_interested', 'rescheduled']),
  callRemark: z.string().max(5000).optional(),
  nextFollowUpAt: z.string().datetime().optional(),
  actionAt: z.string().datetime().optional()
}).refine((value) => {
  if (value.action === 'rescheduled') {
    return !!value.nextFollowUpAt;
  }
  return true;
}, {
  message: 'nextFollowUpAt is required when action is rescheduled',
  path: ['nextFollowUpAt']
});
