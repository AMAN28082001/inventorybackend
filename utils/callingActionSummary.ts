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
  'loan in process',
  'need more information',
  'own house',
  'suitable roof available',
  'high electricity bill (>₹2000)',
  '3 phase connection available',
  'site visit done',
  'negotiation ongoing',
  'converted (deal closed)',
  'payment received',
  'installation pending',
  'installation completed'
]);

const FOLLOW_UP_STATUS_TEXTS = new Set([
  'callback later',
  'call back later',
  'rescheduled',
  'follow-up pending',
  'follow up pending',
  'follow-up required',
  'follow up required',
  'callback scheduled',
  'decision pending',
  'thinking',
  'will call back',
  'busy — call later',
  'busy - call later',
  'not picking on follow-up'
]);

const NOT_INTERESTED_STATUS_TEXTS = new Set([
  'not interested',
  'not interested currently',
  'already installed solar',
  'chose competitor',
  'invalid lead',
  'wrong lead',
  'duplicate lead',
  'out of coverage area',
  'out of service area',
  'budget issue',
  'not feasible',
  'roof not suitable',
  'price too high',
  'trust issue',
  'location not serviceable',
  'no requirement',
  'low electricity bill',
  'tenant (no ownership)',
  'commercial / residential mismatch',
  'no roof / space issue',
  'single phase only',
  'lost lead',
  'not eligible for solar'
]);

/** Mirror FE NOT_CONNECTED_STATUSES_LIST (Calling Reports cards). */
const NOT_CONNECTED_STATUS_TEXTS = new Set([
  'call unanswered',
  'switched off',
  'not reachable',
  'busy / line busy',
  'call disconnected',
  'wrong number',
  'invalid number',
  'number does not exist',
  'duplicate lead',
  'invalid lead',
  'out of service area',
  'incoming not available'
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

export type CallingConnectionKind = 'connected' | 'not_connected';

/** Connected vs not connected — matches FE `classifyCallingConnection`. */
export const classifyCallingConnection = (
  row: CallingActionSummaryInput
): CallingConnectionKind => {
  const status = resolveCallingActionStatusText(row);
  const statusKey = normalizeStatusKey(status);
  const categoryKey = String(row.statusCategory ?? row.status_category ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const action = String(row.action || '')
    .toLowerCase()
    .trim();

  if (statusKey && NOT_CONNECTED_STATUS_TEXTS.has(statusKey)) return 'not_connected';
  if (categoryKey === 'call_connectivity' && statusKey) return 'not_connected';
  if (action === 'start') return 'not_connected';
  if (statusKey) return 'connected';
  if (['called', 'follow_up', 'not_interested', 'rescheduled'].includes(action)) return 'connected';
  return 'not_connected';
};

/** §AI Calling Reports six-card payload. Invariant: totalCalls === connected + notConnected. */
export type CallingReportsCountSummary = {
  totalCalls: number;
  connected: number;
  notConnected: number;
  connectedInterested: number;
  connectedNotInterested: number;
  connectedFollowUp: number;
  interested: number;
  followUp: number;
  notInterested: number;
  others: number;
  total: number;
};

export const buildCallingReportsCountSummary = (
  rows: CallingActionSummaryInput[]
): CallingReportsCountSummary => {
  const summary: CallingReportsCountSummary = {
    totalCalls: 0,
    connected: 0,
    notConnected: 0,
    connectedInterested: 0,
    connectedNotInterested: 0,
    connectedFollowUp: 0,
    interested: 0,
    followUp: 0,
    notInterested: 0,
    others: 0,
    total: 0
  };

  for (const row of rows) {
    const action = String(row.action || '')
      .toLowerCase()
      .trim();
    // Start Call is not a completed call (§AI).
    if (action === 'start') continue;

    summary.total += 1;
    const connection = classifyCallingConnection(row);
    if (connection === 'connected') {
      summary.connected += 1;
      const bucket = classifyCallingActionSummaryBucket(row);
      if (bucket === 'interested') {
        summary.connectedInterested += 1;
        summary.interested += 1;
      } else if (bucket === 'notInterested') {
        summary.connectedNotInterested += 1;
        summary.notInterested += 1;
      } else if (bucket === 'followUp') {
        summary.connectedFollowUp += 1;
        summary.followUp += 1;
      } else {
        summary.others += 1;
      }
    } else {
      summary.notConnected += 1;
      const bucket = classifyCallingActionSummaryBucket(row);
      if (bucket === 'notInterested') summary.notInterested += 1;
      else if (bucket === 'followUp') summary.followUp += 1;
      else if (bucket === 'interested') summary.interested += 1;
      else summary.others += 1;
    }
  }

  summary.totalCalls = summary.connected + summary.notConnected;
  return summary;
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
