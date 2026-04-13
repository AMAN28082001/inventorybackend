import { z } from 'zod';

const timeRangeRegex = /^([01]\d|2[0-3]):([0-5]\d)\s-\s([01]\d|2[0-3]):([0-5]\d)$/;
const hhmmRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const isValidTimeRange = (value: string): boolean => {
  const match = value.match(timeRangeRegex);
  if (!match) return false;
  const startHour = Number(match[1]);
  const startMinute = Number(match[2]);
  const endHour = Number(match[3]);
  const endMinute = Number(match[4]);
  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;
  return endTotal > startTotal;
};

const normalizeVisitTimeFields = (
  data: {
    visitTime?: string;
    visitStartTime?: string;
    visitEndTime?: string;
    visitTimeRange?: string;
  },
  ctx: z.RefinementCtx,
  requireTime: boolean
) => {
  const visitTime = data.visitTime?.trim();
  const visitStartTime = data.visitStartTime?.trim();
  const visitEndTime = data.visitEndTime?.trim();
  const visitTimeRange = data.visitTimeRange?.trim();

  const hasRange =
    typeof visitTime === 'string' && visitTime !== '' &&
    timeRangeRegex.test(visitTime) &&
    isValidTimeRange(visitTime);
  const hasExplicitRange =
    typeof visitTimeRange === 'string' && visitTimeRange !== '' &&
    timeRangeRegex.test(visitTimeRange) &&
    isValidTimeRange(visitTimeRange);
  const hasStartEnd = !!visitStartTime && !!visitEndTime;

  if (requireTime && !hasRange && !hasExplicitRange && !hasStartEnd) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['visitTime'],
      message: 'Provide visitTime (HH:MM - HH:MM), visitTimeRange, or visitStartTime + visitEndTime'
    });
    return null;
  }

  if ((visitStartTime && !visitEndTime) || (!visitStartTime && visitEndTime)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['visitStartTime'],
      message: 'visitStartTime and visitEndTime must be provided together'
    });
    return null;
  }

  if (visitStartTime && !hhmmRegex.test(visitStartTime)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['visitStartTime'],
      message: 'visitStartTime must be in HH:MM format'
    });
    return null;
  }

  if (visitEndTime && !hhmmRegex.test(visitEndTime)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['visitEndTime'],
      message: 'visitEndTime must be in HH:MM format'
    });
    return null;
  }

  let finalStart: string | undefined;
  let finalEnd: string | undefined;
  let finalRange: string | undefined;

  if (hasRange) {
    const [start, end] = visitTime!.split(' - ');
    finalStart = start;
    finalEnd = end;
    finalRange = visitTime!;
  } else if (hasExplicitRange) {
    const [start, end] = visitTimeRange!.split(' - ');
    finalStart = start;
    finalEnd = end;
    finalRange = visitTimeRange!;
  } else if (hasStartEnd) {
    const startTotal = Number(visitStartTime!.slice(0, 2)) * 60 + Number(visitStartTime!.slice(3, 5));
    const endTotal = Number(visitEndTime!.slice(0, 2)) * 60 + Number(visitEndTime!.slice(3, 5));
    if (endTotal <= startTotal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['visitEndTime'],
        message: 'visitEndTime must be after visitStartTime'
      });
      return null;
    }
    finalStart = visitStartTime!;
    finalEnd = visitEndTime!;
    finalRange = `${visitStartTime} - ${visitEndTime}`;
  }

  return {
    visitStartTime: finalStart,
    visitEndTime: finalEnd,
    visitTimeRange: finalRange,
    visitTime: finalRange
  };
};

export const createVisitSchema = z.object({
  quotationId: z.string().min(1),
  visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  visitTime: z.string().optional(),
  visitStartTime: z.string().optional(),
  visitEndTime: z.string().optional(),
  visitTimeRange: z.string().optional(),
  location: z.string().min(1),
  locationLink: z.string().optional(),
  notes: z.string().optional(),
  visitors: z.array(z.object({
    visitorId: z.string().min(1)
  })).optional()
}).superRefine((data, ctx) => {
  normalizeVisitTimeFields(data, ctx, true);
}).transform((data, ctx) => {
  const normalized = normalizeVisitTimeFields(data, ctx, true);
  return normalized ? { ...data, ...normalized } : data;
}).refine((data) => {
  // If locationLink is provided and not empty, it must be a valid URL
  if (data.locationLink && data.locationLink.trim() !== '') {
    try {
      new URL(data.locationLink);
      return true;
    } catch {
      return false;
    }
  }
  return true;
}, {
  message: 'locationLink must be a valid URL if provided',
  path: ['locationLink']
});

export const completeVisitSchema = z.object({
  length: z.number().positive().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  images: z.array(z.string()).optional(),
  notes: z.string().optional()
});

export const incompleteVisitSchema = z.object({
  reason: z.string().min(1, 'Reason is required')
});

export const rescheduleVisitSchema = z.object({
  reason: z.string().min(1, 'Reason is required'),
  visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'visitDate must be in YYYY-MM-DD format').optional(),
  visitTime: z.string().optional(),
  visitStartTime: z.string().optional(),
  visitEndTime: z.string().optional(),
  visitTimeRange: z.string().optional()
}).superRefine((data, ctx) => {
  normalizeVisitTimeFields(data, ctx, false);
}).transform((data, ctx) => {
  const normalized = normalizeVisitTimeFields(data, ctx, false);
  return normalized ? { ...data, ...normalized } : data;
});

export const rejectVisitSchema = z.object({
  rejectionReason: z.string().min(1, 'Rejection reason is required')
});


