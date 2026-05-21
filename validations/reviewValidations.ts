import { z } from 'zod';

export const markReviewAsUsedSchema = z.object({
  usedBy: z.string().max(50).optional()
});
