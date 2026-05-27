/**
 * HR Dealer Actions summary buckets (§J.1) — mirrors frontend `lib/calling-action-summary.ts`.
 * Classify by exact statusText / picker label; do not use substring `includes("interested")`.
 */

export type CallingSummaryBucket = 'interested' | 'followUp' | 'notInterested' | 'others';

export type CallingActionSummaryInput = {
  action?: string | null;
  statusText?: string | null;
  status_text?: string | null;
  statusLabel?: string | null;
  statusReason?: string | null;
  callRemark?: string | null;
  call_remark?: string | null;
  statusCategory?: string | null;
  status_category?: string | null;
};

const normalizeStatusKey = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const INTERESTED_STATUS_TEXTS = new Set([
  'interested',
  'highly interested',
  'site visit scheduled',
  'quotation shared',
  'valid lead',
  'qualified lead',
  'ready to buy',
  'payment pending',
  'documentation pending',
  'loan approved',
  'loan in process'
]);

const FOLLOW_UP_STATUS_TEXTS = new Set([
  'callback later',
  'call back later',
  'rescheduled',
  'follow-up pending',
  'follow up pending',
  'decision pending',
  'thinking',
  'will call back',
  'busy — call later',
  'busy - call later'
]);

const NOT_INTERESTED_STATUS_TEXTS = new Set([
  'not interested',
  'already installed solar',
  'chose competitor',
  'invalid lead',
  'wrong lead',
  'duplicate lead',
  'out of coverage area',
  'budget issue',
  'not feasible',
  'roof not suitable',
  'call unanswered'
]);

const parseTaggedCallRemarkForStatus = (
  rawRemark: unknown
): { status: string | null } => {
  const raw = String(rawRemark || '').trim();
  if (!raw) return { status: null };
  const match = raw.match(/^\[([^\]]+)\]\s*([^|]*?)\s*(?:\|\s*(.*))?$/);
  if (!match) return { status: null };
  const status = (match[2] || '').trim() || null;
  return { status };
};

export const resolveCallingActionStatusText = (row: CallingActionSummaryInput): string => {
  const direct =
    row.statusText ??
    row.status_text ??
    row.statusLabel ??
    row.statusReason ??
    null;
  if (direct && String(direct).trim()) return String(direct).trim();

  const parsed = parseTaggedCallRemarkForStatus(row.callRemark ?? row.call_remark);
  if (parsed.status) return parsed.status;

  return '';
};

export const classifyCallingActionSummaryBucket = (
  row: CallingActionSummaryInput
): CallingSummaryBucket => {
  const action = String(row.action || '').trim().toLowerCase();
  const statusKey = normalizeStatusKey(resolveCallingActionStatusText(row));

  if (statusKey && NOT_INTERESTED_STATUS_TEXTS.has(statusKey)) return 'notInterested';
  if (statusKey && FOLLOW_UP_STATUS_TEXTS.has(statusKey)) return 'followUp';
  if (statusKey && INTERESTED_STATUS_TEXTS.has(statusKey)) return 'interested';

  if (action === 'not_interested') return 'notInterested';
  if (action === 'follow_up' || action === 'rescheduled') return 'followUp';

  // `called` without a positive intent label is not "Interested" (§J.1).
  if (action === 'called' && statusKey && INTERESTED_STATUS_TEXTS.has(statusKey)) {
    return 'interested';
  }

  return 'others';
};

export type ReasonCategory = 'interested' | 'follow_up' | 'not_interested' | 'others';

export const summaryBucketToReasonCategory = (bucket: CallingSummaryBucket): ReasonCategory => {
  if (bucket === 'interested') return 'interested';
  if (bucket === 'followUp') return 'follow_up';
  if (bucket === 'notInterested') return 'not_interested';
  return 'others';
};

export const inferReasonCategoryFromOutcome = (row: CallingActionSummaryInput): ReasonCategory =>
  summaryBucketToReasonCategory(classifyCallingActionSummaryBucket(row));
