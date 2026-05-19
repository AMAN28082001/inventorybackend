import { Request, Response } from 'express';
import { Op, QueryTypes, Sequelize, WhereOptions } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import XLSX from 'xlsx';
import {
  CallingActionHistory,
  CallingLead,
  CallingLeadUploadBatch,
  CallingLeadUploadRow,
  DealerLeadAssignment,
  User,
  sequelize
} from '../models';
import { Dealer } from '../models/index-quotation';
import { logError, logInfo } from '../utils/loggerHelper';
import { emitRealtime, realtimeEvents } from '../utils/realtime';

const MOBILE_KEYS = ['mobile', 'phone', 'contact', 'contact no', 'contact no.', 'contactnumber', 'phone_number', 'phone number', 'mobile number'];
const NAME_KEYS = ['name', 'customername', 'customer name', 'full name'];
const ALT_MOBILE_KEYS = ['altmobile', 'alternate mobile', 'alternate_mobile', 'secondary mobile'];
const K_NUMBER_KEYS = ['k number', 'knumber', 'k_number', 'k no', 'kno'];
const ADDRESS_KEYS = ['address'];
const CITY_KEYS = ['city'];
const STATE_KEYS = ['state', 'data ref. / state', 'data ref/state', 'data ref state'];
const NOTE_KEYS = ['customernote', 'customer note', 'note', 'notes', 'remark', 'remarks'];
const DEFAULT_ACTIVE_LIMIT_PER_DEALER = Number(process.env.ACTIVE_LIMIT_PER_DEALER || 1);
const CALLING_ACTION_FILTER_RANGES = ['daily', 'weekly', 'monthly', 'last_month', 'all'] as const;
const REPORT_ACTIONS = ['called', 'follow_up', 'not_interested', 'rescheduled'] as const;
const ALLOWED_STATUS_CATEGORIES = [
  'call_connectivity',
  'lead_validity',
  'customer_intent',
  'financial',
  'competition',
  'schedule',
  'other'
] as const;
const STATUS_CATEGORY_ALIASES: Record<string, (typeof ALLOWED_STATUS_CATEGORIES)[number]> = {
  'Part 1 — Call & lead quality': 'call_connectivity',
  'Part 2 — Interest & qualification': 'customer_intent',
  'Part 3 — Follow-up & sales': 'schedule',
  'Part 4 — Rejection / lost': 'competition',
  call_connectivity: 'call_connectivity',
  lead_validity: 'lead_validity',
  customer_intent: 'customer_intent',
  financial: 'financial',
  competition: 'competition',
  schedule: 'schedule',
  other: 'other'
};
const DATE_RANGE_ALIASES = ['today', 'week', 'month', 'custom'] as const;

type CallingActionType = 'called' | 'follow_up' | 'not_interested' | 'rescheduled';
type CallingActionFilterRange = (typeof CALLING_ACTION_FILTER_RANGES)[number];
type ReasonCategory = 'interested' | 'follow_up' | 'not_interested' | 'others';
type UploadRowStatus = 'created' | 'duplicate' | 'invalid';

const LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE = Sequelize.literal(`
  NOT EXISTS (
    SELECT 1
    FROM "dealer_lead_assignments" AS newer
    WHERE newer."leadId" = "DealerLeadAssignment"."leadId"
      AND (
        newer."assignedAt" > "DealerLeadAssignment"."assignedAt"
        OR (
          newer."assignedAt" = "DealerLeadAssignment"."assignedAt"
          AND newer."createdAt" > "DealerLeadAssignment"."createdAt"
        )
      )
  )
`);

const HR_UPLOAD_UNASSIGNED_DEALER_SENTINELS = new Set([
  'unassigned',
  'null',
  'none',
  '-',
  'na',
  'n/a',
  'pool',
  'open'
]);

export type HrUploadLeadCounts = {
  rowCount: number;
  assignedCount: number;
  unassignedCount: number;
  completedCount: number;
};

export const isValidHrCallingAssigneeDealerId = (dealerId: string | null | undefined): boolean => {
  if (dealerId === undefined || dealerId === null) return false;
  const trimmed = String(dealerId).trim();
  if (!trimmed) return false;
  return !HR_UPLOAD_UNASSIGNED_DEALER_SENTINELS.has(trimmed.toLowerCase());
};

/**
 * Live batch buckets (§7.8): completed | assigned (valid assignee, not completed) | unassigned.
 * Invariant: assignedCount + unassignedCount + completedCount === rowCount.
 */
export const computeHrUploadLeadCounts = (
  rowCount: number,
  leadBuckets: { completedCount: number; assignedCount: number }
): HrUploadLeadCounts => {
  const completedCount = Math.max(0, leadBuckets.completedCount);
  const assignedCount = Math.max(0, leadBuckets.assignedCount);
  const normalizedRowCount = Math.max(0, rowCount);
  const unassignedCount = Math.max(0, normalizedRowCount - completedCount - assignedCount);
  return {
    rowCount: normalizedRowCount,
    assignedCount,
    unassignedCount,
    completedCount
  };
};

type HrUploadBatchCountRow = {
  batchId: string;
  leadCount: number;
  completedCount: number;
  assignedCount: number;
};

const fetchHrUploadBatchCountRows = async (batchIds: string[]): Promise<Map<string, HrUploadBatchCountRow>> => {
  if (!batchIds.length) return new Map();

  const rows = await sequelize.query<HrUploadBatchCountRow>(
    `
    SELECT
      cl."batchId" AS "batchId",
      COUNT(*)::int AS "leadCount",
      SUM(
        CASE
          WHEN LOWER(COALESCE(dla."status"::text, '')) IN ('completed', 'done', 'closed') THEN 1
          ELSE 0
        END
      )::int AS "completedCount",
      SUM(
        CASE
          WHEN LOWER(COALESCE(dla."status"::text, '')) NOT IN ('completed', 'done', 'closed')
            AND dla."dealerId" IS NOT NULL
            AND TRIM(dla."dealerId") <> ''
            AND LOWER(TRIM(dla."dealerId")) NOT IN (
              'unassigned', 'null', 'none', '-', 'na', 'n/a', 'pool', 'open'
            )
          THEN 1
          ELSE 0
        END
      )::int AS "assignedCount"
    FROM "calling_leads" AS cl
    LEFT JOIN "dealer_lead_assignments" AS dla
      ON dla."leadId" = cl."id"
      AND NOT EXISTS (
        SELECT 1
        FROM "dealer_lead_assignments" AS newer
        WHERE newer."leadId" = dla."leadId"
          AND (
            newer."assignedAt" > dla."assignedAt"
            OR (
              newer."assignedAt" = dla."assignedAt"
              AND newer."createdAt" > dla."createdAt"
            )
          )
      )
    WHERE cl."batchId" IN (:batchIds)
    GROUP BY cl."batchId"
    `,
    {
      replacements: { batchIds },
      type: QueryTypes.SELECT
    }
  );

  const map = new Map<string, HrUploadBatchCountRow>();
  for (const row of rows) {
    map.set(String(row.batchId), {
      batchId: String(row.batchId),
      leadCount: Number(row.leadCount) || 0,
      completedCount: Number(row.completedCount) || 0,
      assignedCount: Number(row.assignedCount) || 0
    });
  }
  return map;
};

const buildHrUploadCountsForBatches = async (
  batches: Array<{ id: string; rowCount: number }>
): Promise<Map<string, HrUploadLeadCounts>> => {
  const batchIds = batches.map((batch) => batch.id);
  const aggregateByBatch = await fetchHrUploadBatchCountRows(batchIds);
  const countsByBatch = new Map<string, HrUploadLeadCounts>();

  for (const batch of batches) {
    const aggregate = aggregateByBatch.get(batch.id);
    countsByBatch.set(
      batch.id,
      computeHrUploadLeadCounts(batch.rowCount, {
        completedCount: aggregate?.completedCount ?? 0,
        assignedCount: aggregate?.assignedCount ?? 0
      })
    );
  }

  return countsByBatch;
};

const hrUploadCountsToApi = (counts: HrUploadLeadCounts) => ({
  rowCount: counts.rowCount,
  assignedCount: counts.assignedCount,
  unassignedCount: counts.unassignedCount,
  completedCount: counts.completedCount,
  counts: {
    assigned: counts.assignedCount,
    unassigned: counts.unassignedCount,
    completed: counts.completedCount
  }
});

const escapeSqlString = (value: string) => value.replace(/'/g, "''");

const batchDealerEligibilityPredicate = (dealerId: string, batchAlias: string) => {
  const escapedDealerId = escapeSqlString(dealerId);
  return `
    EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(${batchAlias}."assignedDealers", '[]'::jsonb)) AS ad(value)
      LEFT JOIN "dealers" AS d ON d."id" = '${escapedDealerId}'
      WHERE (
        -- Legacy: assignedDealers is array of strings (ids, usernames, names)
        jsonb_typeof(ad.value) = 'string'
        AND lower(trim(BOTH '"' FROM ad.value::text)) IN (
          lower(trim('${escapedDealerId}')),
          lower(trim(COALESCE(d."username", ''))),
          lower(trim(COALESCE(d."firstName", ''))),
          lower(trim(COALESCE(d."lastName", ''))),
          lower(trim(concat_ws(' ', COALESCE(d."firstName", ''), COALESCE(d."lastName", ''))))
        )
      ) OR (
        -- Historical/alternate format: assignedDealers is array of objects
        jsonb_typeof(ad.value) = 'object'
        AND (
          lower(trim(COALESCE(ad.value->>'id', ''))) = lower(trim('${escapedDealerId}'))
          OR lower(trim(COALESCE(ad.value->>'dealerId', ''))) = lower(trim('${escapedDealerId}'))
          OR lower(trim(COALESCE(ad.value->>'dealer_id', ''))) = lower(trim('${escapedDealerId}'))
          OR lower(trim(COALESCE(ad.value->>'username', ''))) = lower(trim(COALESCE(d."username", '')))
          OR lower(trim(COALESCE(ad.value->>'name', ''))) IN (
            lower(trim(COALESCE(d."firstName", ''))),
            lower(trim(COALESCE(d."lastName", ''))),
            lower(trim(concat_ws(' ', COALESCE(d."firstName", ''), COALESCE(d."lastName", ''))))
          )
        )
      )
    )
  `;
};

const dealerBatchEligibilityClause = (dealerId: string) =>
  Sequelize.literal(`
    EXISTS (
      SELECT 1
      FROM "calling_leads" AS cl
      LEFT JOIN "calling_lead_upload_batches" AS b
        ON b."id" = cl."batchId"
      WHERE cl."id" = "DealerLeadAssignment"."leadId"
        AND (
          cl."batchId" IS NULL
          OR ${batchDealerEligibilityPredicate(dealerId, 'b')}
        )
    )
  `);

const normalizeMobile = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return null;

  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length > 10) return digits.slice(-10);
  return null;
};

const parseDealerIds = (dealerIds: unknown): string[] => {
  if (Array.isArray(dealerIds)) {
    return dealerIds.map((id) => String(id).trim()).filter(Boolean);
  }
  if (dealerIds === undefined || dealerIds === null) return [];
  const single = String(dealerIds).trim();
  return single ? [single] : [];
};

const extractCell = (row: Record<string, unknown>, keyMatchList: string[]): unknown => {
  const normalizedEntries = Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value] as const);
  for (const key of keyMatchList) {
    const matched = normalizedEntries.find(([entryKey]) => entryKey === key);
    if (matched) return matched[1];
  }
  return undefined;
};

const parseDateSafe = (value: string | undefined): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const toIsoStringOrNull = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const parseTaggedCallRemark = (rawRemark: unknown): { statusCategory: string | null; status: string | null; remark: string | null } => {
  const raw = String(rawRemark || '').trim();
  if (!raw) return { statusCategory: null, status: null, remark: null };
  const match = raw.match(/^\[([^\]]+)\]\s*([^|]*?)\s*(?:\|\s*(.*))?$/);
  if (!match) {
    return { statusCategory: null, status: null, remark: raw };
  }
  const statusCategory = (match[1] || '').trim() || null;
  const status = (match[2] || '').trim() || null;
  const remark = (match[3] || '').trim() || null;
  return { statusCategory, status, remark };
};

const normalizeStatusCategory = (rawCategory: unknown): (typeof ALLOWED_STATUS_CATEGORIES)[number] | null => {
  const clean = String(rawCategory || '').trim();
  if (!clean) return null;
  const mapped = STATUS_CATEGORY_ALIASES[clean] || clean;
  return (ALLOWED_STATUS_CATEGORIES as readonly string[]).includes(mapped) ? (mapped as (typeof ALLOWED_STATUS_CATEGORIES)[number]) : null;
};

const callingActionToApiJson = (row: any) => {
  const parsed = parseTaggedCallRemark(row.callRemark ?? row.call_remark);
  const normalizedCategory = normalizeStatusCategory(row.statusCategory ?? row.status_category ?? parsed.statusCategory);
  return {
    // Stable identifier: UI should update the same card for the same leadId.
    id: row.leadId,
    leadId: row.leadId,
    name: row.lead?.name || '',
    mobile: row.lead?.mobile || '',
    action: row.action,
    actionAt: toIsoStringOrNull(row.actionAt),
    // compatibility
    callRemark: row.callRemark,
    statusLabel: row.statusLabel,
    statusReason: row.statusReason,
    isCustomReason: row.isCustomReason,
    statusCategoryKey: row.statusCategory,
    statusCategoryLabel: row.statusLabel,
    // explicit fields required by frontend
    statusCategory: normalizedCategory,
    status: row.statusLabel || parsed.status || row.action || row.status || null,
    remark: row.statusReason || parsed.remark || null,
    // Required by Calling Data > Recent Actions card
    kNumber: row.kNumber ?? row.k_number ?? row.lead?.kNumber ?? row.lead?.k_number ?? null,
    address: row.address ?? row.leadAddress ?? row.lead_address ?? row.lead?.address ?? null,
    nextFollowUpAt: toIsoStringOrNull(row.nextFollowUpAt),
    assignmentStatus: row.status
  };
};

const NOT_CONNECTED_STATUS_TEXTS = new Set([
  'call unanswered',
  'switched off',
  'not reachable',
  'busy / line busy',
  'call disconnected',
  'wrong number',
  'invalid number',
  'number does not exist'
]);

const classifyActionStage = (action: any): 'connected' | 'not_connected' => {
  const statusText = String(action.status || '').trim().toLowerCase();
  return NOT_CONNECTED_STATUS_TEXTS.has(statusText) ? 'not_connected' : 'connected';
};

const parsePositiveInt = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : fallback;
};

const parseDateBoundary = (value: unknown, boundary: 'start' | 'end'): Date | null => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  if (boundary === 'start') parsed.setHours(0, 0, 0, 0);
  if (boundary === 'end') parsed.setHours(23, 59, 59, 999);
  return parsed;
};

const getMonthRange = (reference: Date): { from: Date; to: Date } => {
  const year = reference.getFullYear();
  const month = reference.getMonth();
  const from = new Date(year, month, 1);
  from.setHours(0, 0, 0, 0);
  const to = new Date(year, month + 1, 0);
  to.setHours(23, 59, 59, 999);
  return { from, to };
};

const getReasonCategoryFromAction = (action: CallingActionType): ReasonCategory => {
  if (action === 'called') return 'interested';
  if (action === 'follow_up') return 'follow_up';
  if (action === 'not_interested') return 'not_interested';
  return 'others';
};

const buildCustomerAddress = (lead: { address?: string | null; city?: string | null; state?: string | null }): string | null => {
  const parts = [lead.address, lead.city, lead.state].map((value) => String(value || '').trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
};

const inferStatusCategoryFromRemark = (remark?: string | null): string | null => {
  const normalized = String(remark || '').toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('switched off') || normalized.includes('not reachable') || normalized.includes('busy')) {
    return 'call_connectivity';
  }
  if (normalized.includes('invalid') || normalized.includes('wrong number')) {
    return 'lead_validity';
  }
  if (normalized.includes('not interested') || normalized.includes('budget') || normalized.includes('converted')) {
    return 'customer_intent';
  }
  if (normalized.includes('follow up') || normalized.includes('reschedule')) {
    return 'schedule';
  }
  return null;
};

type LeadStatusMeta = {
  statusCategory: string | null;
  statusLabel: string | null;
  statusReason: string | null;
  isCustomReason: boolean;
};

const resolveReportDateRange = (
  range: CallingActionFilterRange,
  reqDateRangeRaw: string,
  startDate: Date | null,
  endDate: Date | null
): { rangeStart: Date | null; rangeEnd: Date | null } => {
  let rangeStart: Date | null = startDate;
  let rangeEnd: Date | null = endDate;
  const reqDateRange = reqDateRangeRaw.toLowerCase();

  if (reqDateRange === 'custom' && (startDate || endDate)) {
    return { rangeStart, rangeEnd };
  }

  const now = new Date();
  const usePresetByDateRange = (DATE_RANGE_ALIASES as readonly string[]).includes(reqDateRange);
  const effectivePreset = usePresetByDateRange ? reqDateRange : range;

  if (!startDate && !endDate) {
    if (effectivePreset === 'daily' || effectivePreset === 'today') {
      rangeStart = new Date(now);
      rangeStart.setHours(0, 0, 0, 0);
      rangeEnd = new Date(now);
      rangeEnd.setHours(23, 59, 59, 999);
    } else if (effectivePreset === 'weekly' || effectivePreset === 'week') {
      rangeStart = new Date(now);
      rangeStart.setDate(now.getDate() - 6);
      rangeStart.setHours(0, 0, 0, 0);
      rangeEnd = new Date(now);
      rangeEnd.setHours(23, 59, 59, 999);
    } else if (effectivePreset === 'monthly' || effectivePreset === 'month') {
      const monthRange = getMonthRange(now);
      rangeStart = monthRange.from;
      rangeEnd = monthRange.to;
    } else if (effectivePreset === 'last_month') {
      const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const monthRange = getMonthRange(previousMonth);
      rangeStart = monthRange.from;
      rangeEnd = monthRange.to;
    }
  }

  return { rangeStart, rangeEnd };
};

const buildLatestStatusMetaMap = async (dealerId: string, leadIds: string[]): Promise<Map<string, LeadStatusMeta>> => {
  if (!leadIds.length) return new Map();

  const rows = await CallingActionHistory.findAll({
    where: {
      dealerId,
      leadId: { [Op.in]: leadIds }
    },
    order: [['actionAt', 'DESC'], ['createdAt', 'DESC']]
  });

  const map = new Map<string, LeadStatusMeta>();
  for (const row of rows) {
    if (!map.has(row.leadId)) {
      map.set(row.leadId, {
        statusCategory: row.statusCategory || inferStatusCategoryFromRemark(row.callRemark) || null,
        statusLabel: row.statusLabel || null,
        statusReason: row.statusReason || null,
        isCustomReason: Boolean(row.isCustomReason)
      });
    }
  }

  return map;
};

const buildCallingActionsFilter = (req: Request): WhereOptions => {
  const rawRange = String(req.query.range ?? req.query.dateRange ?? 'all')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const rangeAliases: Record<string, CallingActionFilterRange> = {
    day: 'daily',
    today: 'daily',
    daily: 'daily',
    week: 'weekly',
    weekly: 'weekly',
    month: 'monthly',
    monthly: 'monthly',
    lastmonth: 'last_month',
    last_month: 'last_month',
    all: 'all'
  };
  const requestedRange = rangeAliases[rawRange] || 'all';
  const range: CallingActionFilterRange =
    (CALLING_ACTION_FILTER_RANGES as readonly string[]).includes(requestedRange)
      ? (requestedRange as CallingActionFilterRange)
      : 'all';
  const dealerIdRaw =
    req.query.dealerId ??
    req.query.dealer_id ??
    req.query.selectedDealerId ??
    req.query.selected_dealer_id;
  const dealerId = dealerIdRaw ? String(dealerIdRaw).trim() : '';
  const dealerName =
    req.query.dealerName ??
    req.query.dealer_name ??
    req.query.dealer ??
    req.query.selectedDealerName;
  const category = req.query.category ? String(req.query.category).trim() : '';
  const statusCategoryKey = req.query.statusCategoryKey ? String(req.query.statusCategoryKey).trim() : '';
  const reason = req.query.reason ? String(req.query.reason).trim() : '';
  const action = req.query.action ? String(req.query.action).trim() : '';
  const search = req.query.search ? String(req.query.search).trim() : '';
  const dateRange = req.query.dateRange ? String(req.query.dateRange).trim().toLowerCase() : '';
  const startDate = parseDateBoundary(req.query.startDate ?? req.query.start_date, 'start');
  const endDate = parseDateBoundary(req.query.endDate ?? req.query.end_date, 'end');

  const { rangeStart, rangeEnd } = resolveReportDateRange(range, dateRange, startDate, endDate);

  const filter: WhereOptions = {};
  if (dealerId) {
    (filter as any).dealerId = dealerId;
  }
  if (!dealerId && dealerName) {
    (filter as any).dealerName = { [Op.iLike]: `%${String(dealerName).trim()}%` };
  }
  if (rangeStart || rangeEnd) {
    const actionAtBound: Record<symbol, Date> = {} as Record<symbol, Date>;
    const createdAtBound: Record<symbol, Date> = {} as Record<symbol, Date>;
    if (rangeStart) {
      actionAtBound[Op.gte] = rangeStart;
      createdAtBound[Op.gte] = rangeStart;
    }
    if (rangeEnd) {
      actionAtBound[Op.lte] = rangeEnd;
      createdAtBound[Op.lte] = rangeEnd;
    }
    // Backward compatibility: some historical rows may miss actionAt.
    (filter as any)[Op.and] = [
      {
        [Op.or]: [
          { actionAt: actionAtBound },
          { createdAt: createdAtBound }
        ]
      }
    ];
  }
  if (category || statusCategoryKey) {
    (filter as any).statusCategory = statusCategoryKey || category;
  }
  if (reason) {
    (filter as any).statusReason = { [Op.iLike]: `%${reason}%` };
  }
  if (action && (REPORT_ACTIONS as readonly string[]).includes(action)) {
    (filter as any).action = action;
  } else {
    (filter as any).action = { [Op.in]: REPORT_ACTIONS };
  }
  if (search) {
    (filter as any)[Op.or] = [
      { leadId: { [Op.iLike]: `%${search}%` } },
      { customerName: { [Op.iLike]: `%${search}%` } },
      { customerMobile: { [Op.iLike]: `%${search}%` } },
      { dealerName: { [Op.iLike]: `%${search}%` } },
      { statusReason: { [Op.iLike]: `%${search}%` } },
      { callRemark: { [Op.iLike]: `%${search}%` } }
    ];
  }
  return filter;
};

const buildCallingActionsResponse = async (req: Request) => {
  const page = parsePositiveInt(req.query.page, 1);
  const limit = Math.min(parsePositiveInt(req.query.limit, 20), 100);
  const offset = (page - 1) * limit;
  const where = buildCallingActionsFilter(req);

  const [rows, groupedCounts] = await Promise.all([
    CallingActionHistory.findAndCountAll({
      where,
      order: [['actionAt', 'DESC'], ['createdAt', 'DESC']],
      limit,
      offset
    }),
    CallingActionHistory.findAll({
      attributes: ['action', [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']],
      where,
      group: ['action']
    })
  ]);

  const actionDealerIds = Array.from(new Set(rows.rows.map((row) => row.dealerId)));
  const [allDealers, actionDealers] = await Promise.all([
    Dealer.findAll({
      where: { role: 'dealer', isActive: true },
      attributes: ['id', 'firstName', 'lastName'],
      order: [['firstName', 'ASC'], ['lastName', 'ASC']]
    }),
    actionDealerIds.length
      ? Dealer.findAll({
        where: { id: { [Op.in]: actionDealerIds } },
        attributes: ['id', 'firstName', 'lastName']
      })
      : Promise.resolve([])
  ]);
  const dealerNameMap = new Map<string, string>();
  for (const dealer of actionDealers) {
    dealerNameMap.set(dealer.id, `${dealer.firstName || ''} ${dealer.lastName || ''}`.trim());
  }

  const total = rows.count;
  const summarySeed = {
    interested: 0,
    follow_up: 0,
    not_interested: 0,
    others: 0,
    total
  };
  const summary = groupedCounts.reduce((acc, row: any) => {
    const action = row.get('action') as CallingActionType;
    const count = Number(row.get('count') || 0);
    if (action === 'called') acc.interested += count;
    else if (action === 'follow_up') acc.follow_up += count;
    else if (action === 'not_interested') acc.not_interested += count;
    else acc.others += count;
    return acc;
  }, summarySeed);

  const actionRows = rows.rows.map((row) => ({
      id: row.id,
      leadId: row.leadId,
      dealerId: row.dealerId,
      dealerName: row.dealerName || dealerNameMap.get(row.dealerId) || '',
      action: row.action,
      reasonCategory: row.reasonCategory || getReasonCategoryFromAction(row.action as CallingActionType),
      callRemark: row.callRemark,
      statusCategory: row.statusCategory,
      statusLabel: row.statusLabel,
      statusReason: row.statusReason,
      isCustomReason: row.isCustomReason,
      statusCategoryKey: row.statusCategory,
      statusCategoryLabel: row.statusLabel,
      actionAt: toIsoStringOrNull(row.actionAt),
      nextFollowUpAt: toIsoStringOrNull(row.nextFollowUpAt),
      customerName: row.customerName,
      customerMobile: row.customerMobile,
      customerAddress: row.customerAddress,
      createdAt: toIsoStringOrNull(row.createdAt)
    }));

  const dealers = allDealers.map((dealer) => ({
    dealerId: dealer.id,
    dealerName: `${dealer.firstName || ''} ${dealer.lastName || ''}`.trim()
  }));

  return {
    // Primary list key
    actions: actionRows,
    // Compatibility aliases for different frontend integrations
    list: actionRows,
    rows: actionRows,
    items: actionRows,
    summary: {
      interested: summary.interested,
      followUp: summary.follow_up,
      notInterested: summary.not_interested,
      others: summary.others,
      total: summary.total
    },
    summaryCounts: summary,
    dealers,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1
    }
  };
};

const resolveAssignedByUserId = async (req: Request, transaction: any): Promise<string> => {
  const requesterId = req.user?.id;
  const requesterUsername = req.user?.username;

  if (requesterId) {
    const byId = await User.findByPk(requesterId, { transaction });
    if (byId) return byId.id;
  }

  if (requesterUsername) {
    const byUsername = await User.findOne({
      where: { username: requesterUsername },
      attributes: ['id'],
      transaction
    });
    if (byUsername) return byUsername.id;
  }

  // Fallback to an active admin identity to satisfy FK constraint when HR is authenticated via account_managers table.
  const fallback = await User.findOne({
    where: {
      role: {
        [Op.in]: ['super-admin', 'super-admin-manager', 'admin']
      },
      is_active: true
    },
    attributes: ['id'],
    order: [['created_at', 'ASC']],
    transaction
  });

  if (fallback) return fallback.id;
  throw new Error('No valid users.id available for assignedBy');
};

const promoteQueuedLeadIfSlotAvailable = async (
  dealerId: string,
  activeLimitPerDealer: number,
  transaction: any
): Promise<void> => {
  // No assignment cap: selected-batch leads should keep flowing to eligible dealers.
  // Keep argument for backward compatibility with callers.
  void activeLimitPerDealer;

  const queued = await DealerLeadAssignment.findOne({
    where: {
      dealerId,
      status: 'queued'
    },
    order: [['assignedAt', 'ASC']],
    transaction,
    lock: transaction.LOCK.UPDATE
  });

  if (!queued) {
    // If this dealer has capacity but no dealer-specific queue, claim one oldest unassigned
    // lead from a batch where this dealer is explicitly eligible.
    const unassignedLead = await CallingLead.findOne({
      where: {
        [Op.and]: [
          Sequelize.literal(`
            NOT EXISTS (
              SELECT 1 FROM "dealer_lead_assignments" AS da
              WHERE da."leadId" = "CallingLead"."id"
            )
          `),
          Sequelize.literal(`
            (
              "CallingLead"."batchId" IS NULL
              OR EXISTS (
                SELECT 1
                FROM "calling_lead_upload_batches" AS b
                WHERE b."id" = "CallingLead"."batchId"
                  AND ${batchDealerEligibilityPredicate(dealerId, 'b')}
              )
            )
          `)
        ]
      },
      order: [['createdAt', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (unassignedLead) {
      const assignedBy = await resolveSystemAssignedByUserId(transaction);
      await DealerLeadAssignment.create(
        {
          id: uuidv4(),
          leadId: unassignedLead.id,
          dealerId,
          assignedBy,
          assignedAt: new Date(),
          status: 'assigned'
        },
        { transaction }
      );
      return;
    }

    // Rebalance within eligible selected batches only:
    // if no unassigned lead exists, move the oldest pending eligible lead from another dealer.
    const reassignable = await DealerLeadAssignment.findOne({
      where: {
        [Op.and]: [
          {
            dealerId: { [Op.ne]: dealerId },
            status: { [Op.in]: ['queued', 'assigned', 'active'] }
          },
          LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE,
          dealerBatchEligibilityClause(dealerId)
        ]
      },
      order: [['assignedAt', 'ASC'], ['createdAt', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (reassignable) {
      await reassignable.update(
        {
          dealerId,
          status: 'assigned',
          assignedAt: new Date(),
          action: null,
          callRemark: null,
          nextFollowUpAt: null,
          actionAt: null
        },
        { transaction }
      );
    }
    return;
  }

  await queued.update(
    {
      dealerId,
      status: 'assigned',
      assignedAt: new Date(),
      action: null,
      callRemark: null,
      nextFollowUpAt: null,
      actionAt: null
    },
    { transaction }
  );
};

const resolveSystemAssignedByUserId = async (transaction: any): Promise<string> => {
  const fallback = await User.findOne({
    where: {
      role: {
        [Op.in]: ['super-admin', 'super-admin-manager', 'admin']
      },
      is_active: true
    },
    attributes: ['id'],
    order: [['created_at', 'ASC']],
    transaction
  });
  if (!fallback) {
    throw new Error('No active admin user found for assignment fallback');
  }
  return fallback.id;
};

const isLeadEligibleForDealerPool = async (
  leadId: string,
  dealerId: string,
  transaction: any
): Promise<boolean> => {
  const count = await CallingLead.count({
    where: {
      id: leadId,
      [Op.and]: [
        Sequelize.literal(`
          (
            "CallingLead"."batchId" IS NULL
            OR EXISTS (
              SELECT 1
              FROM "calling_lead_upload_batches" AS b
              WHERE b."id" = "CallingLead"."batchId"
                AND ${batchDealerEligibilityPredicate(dealerId, 'b')}
            )
          )
        `)
      ]
    },
    transaction
  });
  return count > 0;
};

const REASSIGNABLE_ASSIGNMENT_STATUSES = new Set(['queued', 'assigned', 'active']);

const findLatestLeadAssignment = async (leadId: string, transaction: any) =>
  DealerLeadAssignment.findOne({
    where: {
      leadId,
      [Op.and]: [LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE]
    },
    transaction,
    lock: transaction.LOCK.UPDATE
  });

/** Move a pool / queued row from another dealer when this dealer is batch-eligible (same rules as promote). */
const tryReassignLatestAssignmentToDealer = async (
  leadId: string,
  dealerId: string,
  transaction: any
): Promise<DealerLeadAssignment | null> => {
  const latest = await findLatestLeadAssignment(leadId, transaction);
  if (!latest || latest.dealerId === dealerId) {
    return latest;
  }
  if (!REASSIGNABLE_ASSIGNMENT_STATUSES.has(String(latest.status))) {
    return null;
  }
  const eligible = await isLeadEligibleForDealerPool(leadId, dealerId, transaction);
  if (!eligible) {
    return null;
  }
  await latest.update(
    {
      dealerId,
      status: 'assigned',
      assignedAt: new Date(),
      action: null,
      callRemark: null,
      nextFollowUpAt: null,
      actionAt: null
    },
    { transaction }
  );
  await latest.reload({ transaction });
  return latest;
};

/** Body may send username or legacy id; map to authenticated dealer when it is the same account. */
const resolveEffectiveCallingDealerId = async (
  bodyDealerIdRaw: string | undefined,
  authDealerId: string
): Promise<string> => {
  const bodyDealerId = String(bodyDealerIdRaw || '').trim();
  if (!bodyDealerId || bodyDealerId === authDealerId) {
    return authDealerId;
  }
  const dealer = await Dealer.findOne({
    attributes: ['id'],
    where: {
      [Op.or]: [{ id: bodyDealerId }, { username: bodyDealerId }]
    }
  });
  if (dealer?.id === authDealerId) {
    return authDealerId;
  }
  return bodyDealerId;
};

const claimCallingLeadForDealer = async (
  leadId: string,
  dealerId: string,
  transaction: any
): Promise<DealerLeadAssignment> => {
  const latest = await findLatestLeadAssignment(leadId, transaction);

  if (latest) {
    if (latest.dealerId === dealerId) {
      return latest;
    }
    const reassigned = await tryReassignLatestAssignmentToDealer(leadId, dealerId, transaction);
    if (reassigned) {
      return reassigned;
    }
    const error: any = new Error('LEAD_NOT_ASSIGNED');
    error.code = 'LEAD_004';
    throw error;
  }

  const lead = await CallingLead.findByPk(leadId, {
    transaction,
    lock: transaction.LOCK.UPDATE
  });
  if (!lead) {
    const error: any = new Error('LEAD_NOT_FOUND');
    error.code = 'RES_001';
    throw error;
  }

  const eligible = await isLeadEligibleForDealerPool(leadId, dealerId, transaction);
  if (!eligible) {
    const error: any = new Error('LEAD_NOT_ASSIGNED');
    error.code = 'LEAD_004';
    throw error;
  }

  const assignedBy = await resolveSystemAssignedByUserId(transaction);
  return DealerLeadAssignment.create(
    {
      id: uuidv4(),
      leadId,
      dealerId,
      assignedBy,
      assignedAt: new Date(),
      status: 'assigned'
    },
    { transaction }
  );
};

const resolveAssignmentForDealerAction = async (
  leadId: string,
  dealerId: string,
  transaction: any,
  allowClaim: boolean
): Promise<DealerLeadAssignment> => {
  const scoped = await DealerLeadAssignment.findOne({
    where: {
      [Op.and]: [
        { leadId, dealerId },
        LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE
      ]
    },
    transaction,
    lock: transaction.LOCK.UPDATE
  });
  if (scoped) {
    return scoped;
  }

  if (!allowClaim) {
    const error: any = new Error('LEAD_NOT_ASSIGNED');
    error.code = 'LEAD_004';
    throw error;
  }

  return claimCallingLeadForDealer(leadId, dealerId, transaction);
};

const shouldAllowClaimOnAction = (
  action: string,
  body: Record<string, unknown>
): boolean => {
  if (action === 'start') return true;
  if (['called', 'follow_up', 'not_interested', 'rescheduled'].includes(action)) return true;
  const truthy = (value: unknown) =>
    value === true || value === 'true' || value === 1 || value === '1';
  return truthy(body.claim) || truthy(body.autoAssign);
};

const normalizeAssignmentStatusFromClient = (raw?: unknown): string | null => {
  if (raw === undefined || raw === null || raw === '') return null;
  const normalized = String(raw).trim().toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'pending') return 'queued';
  if (normalized === 'inprogress') return 'in_progress';
  if (['queued', 'assigned', 'active', 'in_progress', 'rescheduled', 'completed'].includes(normalized)) {
    return normalized;
  }
  return 'assigned';
};

const buildCallingLeadQueuePayload = async (
  assignment: DealerLeadAssignment,
  transaction: any
) => {
  const [lead, dealer] = await Promise.all([
    CallingLead.findByPk(assignment.leadId, { transaction }),
    Dealer.findByPk(assignment.dealerId, {
      attributes: ['firstName', 'lastName'],
      transaction
    })
  ]);
  const assignedDealerName = dealer
    ? `${dealer.firstName || ''} ${dealer.lastName || ''}`.trim()
    : null;

  return {
    leadId: assignment.leadId,
    id: assignment.leadId,
    name: lead?.name || '',
    mobile: lead?.mobile || '',
    altMobile: lead?.altMobile || null,
    kNumber: lead?.kNumber || null,
    address: lead?.address || null,
    city: lead?.city || null,
    state: lead?.state || null,
    customerNote: lead?.customerNote || null,
    assignedDealerId: assignment.dealerId,
    assigned_dealer_id: assignment.dealerId,
    assignedDealerName,
    assigned_dealer_name: assignedDealerName,
    assignedToDealerId: assignment.dealerId,
    assigned_to_dealer_id: assignment.dealerId,
    status: assignment.status,
    assignmentStatus: assignment.status
  };
};

const assignCallingLeadToDealerFromRequest = async (
  req: Request,
  res: Response,
  logLabel: string
): Promise<void> => {
  try {
    const dealerId = await resolveDealerIdForQueue(req);
    if (!dealerId) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { leadId } = req.params;
    const body = (req.body || {}) as Record<string, unknown>;
    const requestedDealerId = String(
      body.assignedDealerId || body.assigned_dealer_id || body.dealerId || body.dealer_id || ''
    ).trim();
    const targetDealerId = await resolveEffectiveCallingDealerId(
      requestedDealerId || dealerId,
      dealerId
    );
    if (targetDealerId !== dealerId) {
      res.status(403).json({
        success: false,
        error: { code: 'LEAD_004', message: 'Lead not assigned to dealer' }
      });
      return;
    }

    let assignmentPayload: any = null;

    await sequelize.transaction(async (transaction) => {
      let assignment = await claimCallingLeadForDealer(leadId, dealerId, transaction);
      const requestedStatus = normalizeAssignmentStatusFromClient(body.status);
      if (requestedStatus && requestedStatus !== assignment.status) {
        await assignment.update({ status: requestedStatus as any }, { transaction });
        await assignment.reload({ transaction });
      }
      assignmentPayload = await buildCallingLeadQueuePayload(assignment, transaction);
    });

    const snapshot = await buildDealerQueueSnapshot(dealerId, 1000);
    applyNoCacheHeaders(res);
    res.json({
      success: true,
      data: {
        ...snapshot,
        lead: assignmentPayload,
        currentLead: assignmentPayload,
        nextLead: assignmentPayload
      }
    });
  } catch (error) {
    const errorCode = (error as any)?.code;
    if (errorCode === 'LEAD_004') {
      res.status(403).json({ success: false, error: { code: 'LEAD_004', message: 'Lead not assigned to dealer' } });
      return;
    }
    if (errorCode === 'RES_001') {
      res.status(404).json({ success: false, error: { code: 'RES_001', message: 'Lead not found' } });
      return;
    }
    logError(logLabel, error, {
      dealerId: req.dealer?.id,
      leadId: req.params.leadId
    });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const claimDealerCallingLead = async (req: Request, res: Response): Promise<void> => {
  await assignCallingLeadToDealerFromRequest(req, res, 'Claim dealer calling lead error');
};

export const assignDealerCallingLead = async (req: Request, res: Response): Promise<void> => {
  await assignCallingLeadToDealerFromRequest(req, res, 'Assign dealer calling lead error');
};

export const patchDealerCallingLead = async (req: Request, res: Response): Promise<void> => {
  await assignCallingLeadToDealerFromRequest(req, res, 'Patch dealer calling lead error');
};

export const uploadCallingLeadsCsv = async (req: Request, res: Response): Promise<void> => {
  try {
    const filesByField = ((req as any).files || {}) as Record<string, Express.Multer.File[]>;
    const file = (filesByField.file && filesByField.file[0]) || (filesByField.csvFile && filesByField.csvFile[0]);
    if (!file) {
      res.status(400).json({
        success: false,
        error: { code: 'LEAD_001', message: 'Invalid CSV format' }
      });
      return;
    }

    const dealerIds = parseDealerIds(req.body.dealerIds).length
      ? parseDealerIds(req.body.dealerIds)
      : parseDealerIds(req.body['dealerIds[]']);
    const activeLimitPerDealer = Number(
      req.body.activeLimitPerDealer ??
      req.body.activeLeadsLimit ??
      DEFAULT_ACTIVE_LIMIT_PER_DEALER
    );
    if (dealerIds.length === 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_002',
          message: 'Required field missing',
          details: [{ field: 'dealerIds', message: 'dealerIds[] cannot be empty' }]
        }
      });
      return;
    }

    const dealers = await Dealer.findAll({
      where: { id: { [Op.in]: dealerIds }, role: 'dealer', isActive: true },
      attributes: ['id']
    });
    if (dealers.length !== dealerIds.length) {
      const validIds = new Set(dealers.map((dealer) => dealer.id));
      const invalidIds = dealerIds.filter((id) => !validIds.has(id));
      res.status(400).json({
        success: false,
        error: {
          code: 'LEAD_006',
          message: 'Invalid dealer IDs',
          details: invalidIds.map((id) => ({ field: 'dealerIds', message: `Invalid dealer id: ${id}` }))
        }
      });
      return;
    }

    const workbook = XLSX.read(file.buffer, { type: 'buffer', raw: false });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    if (!sheet) {
      res.status(400).json({
        success: false,
        error: { code: 'LEAD_001', message: 'Invalid CSV format' }
      });
      return;
    }

    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[];
    if (!rows.length) {
      res.status(400).json({
        success: false,
        error: { code: 'LEAD_002', message: 'No valid rows found in CSV' }
      });
      return;
    }

    const parsed = rows.length;
    const batchId = uuidv4();
    const normalizedRows: Array<{
      rowIndex: number;
      name: string;
      mobile: string;
      altMobile: string | null;
      kNumber: string | null;
      address: string | null;
      city: string | null;
      state: string | null;
      customerNote: string | null;
      rawPayload: Record<string, unknown>;
    }> = [];
    const rowAudit: Array<{
      rowIndex: number;
      status: UploadRowStatus;
      customerName: string | null;
      customerMobile: string | null;
      customerAddress: string | null;
      leadId?: string | null;
      rawPayload: Record<string, unknown>;
    }> = [];
    const duplicateInFile = new Set<string>();
    const seenMobiles = new Set<string>();

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rowIndex = index + 1;
      const mobileRaw = extractCell(row, MOBILE_KEYS);
      const mobile = normalizeMobile(mobileRaw);
      const name = String(extractCell(row, NAME_KEYS) || '').trim() || 'Unknown';
      const altMobile = normalizeMobile(extractCell(row, ALT_MOBILE_KEYS));
      const kNumber = String(extractCell(row, K_NUMBER_KEYS) || '').trim() || null;
      const address = String(extractCell(row, ADDRESS_KEYS) || '').trim() || null;
      const city = String(extractCell(row, CITY_KEYS) || '').trim() || null;
      const state = String(extractCell(row, STATE_KEYS) || '').trim() || null;
      const customerNote = String(extractCell(row, NOTE_KEYS) || '').trim() || null;
      const customerAddress = buildCustomerAddress({ address, city, state });

      if (!mobile) {
        rowAudit.push({
          rowIndex,
          status: 'invalid',
          customerName: name,
          customerMobile: null,
          customerAddress,
          rawPayload: row
        });
        continue;
      }

      if (seenMobiles.has(mobile)) {
        duplicateInFile.add(mobile);
        rowAudit.push({
          rowIndex,
          status: 'duplicate',
          customerName: name,
          customerMobile: mobile,
          customerAddress,
          rawPayload: row
        });
        continue;
      }
      seenMobiles.add(mobile);

      normalizedRows.push({
        rowIndex,
        name,
        mobile,
        altMobile,
        kNumber,
        address,
        city,
        state,
        customerNote,
        rawPayload: row
      });
    }

    if (!normalizedRows.length) {
      res.status(400).json({
        success: false,
        error: { code: 'LEAD_002', message: 'No valid rows found in CSV' }
      });
      return;
    }

    const existingLeads = await CallingLead.findAll({
      where: { mobileNormalized: { [Op.in]: normalizedRows.map((row) => row.mobile) } },
      attributes: ['mobileNormalized']
    });
    const existingMobiles = new Set(existingLeads.map((lead: any) => lead.mobileNormalized));

    const rowsToCreate = normalizedRows.filter((row) => !existingMobiles.has(row.mobile));
    const skippedDuplicate = duplicateInFile.size + normalizedRows.length - rowsToCreate.length;
    const rowsByMobile = new Map(normalizedRows.map((row) => [row.mobile, row]));
    for (const existingMobile of existingMobiles) {
      const row = rowsByMobile.get(existingMobile);
      if (!row) continue;
      rowAudit.push({
        rowIndex: row.rowIndex,
        status: 'duplicate',
        customerName: row.name,
        customerMobile: row.mobile,
        customerAddress: buildCustomerAddress(row),
        rawPayload: row.rawPayload
      });
    }

    let created = 0;
    let assigned = 0;
    let queued = 0;
    let roundRobinPointer = 0;

    await sequelize.transaction(async (transaction) => {
      await CallingLeadUploadBatch.create({
        id: batchId,
        fileName: file.originalname || 'upload.csv',
        uploadedBy: req.user?.id || 'unknown',
        uploadedAt: new Date(),
        rowCount: parsed,
        assignedDealers: dealerIds
      }, { transaction });

      const assignedByUserId = await resolveAssignedByUserId(req, transaction);

      for (const row of rowsToCreate) {
        const lead = await CallingLead.create(
          {
            id: uuidv4(),
            batchId,
            name: row.name,
            mobile: row.mobile,
            mobileNormalized: row.mobile,
            altMobile: row.altMobile,
            kNumber: row.kNumber,
            address: row.address,
            city: row.city,
            state: row.state,
            customerNote: row.customerNote,
            rawPayload: row.rawPayload
          },
          { transaction }
        );
        created += 1;

        // Fair dealer-wise assignment: strict round-robin across selected dealers.
        const dealerId = dealerIds[roundRobinPointer % dealerIds.length];
        roundRobinPointer += 1;
        const nextStatus: 'assigned' | 'queued' = 'assigned';

        await DealerLeadAssignment.create(
          {
            id: uuidv4(),
            leadId: lead.id,
            dealerId,
            assignedBy: assignedByUserId,
            assignedAt: new Date(),
            status: nextStatus as any
          },
          { transaction }
        );
        if (nextStatus === 'assigned') assigned += 1;
        else queued += 1;

        rowAudit.push({
          rowIndex: row.rowIndex,
          status: 'created',
          customerName: row.name,
          customerMobile: row.mobile,
          customerAddress: buildCustomerAddress(row),
          leadId: lead.id,
          rawPayload: row.rawPayload
        });
      }

      if (rowAudit.length > 0) {
        await CallingLeadUploadRow.bulkCreate(
          rowAudit
            .filter((row) => row.rowIndex > 0)
            .sort((a, b) => a.rowIndex - b.rowIndex)
            .map((row) => ({
              id: uuidv4(),
              batchId,
              rowIndex: row.rowIndex,
              customerName: row.customerName,
              customerMobile: row.customerMobile,
              customerAddress: row.customerAddress,
              status: row.status,
              leadId: row.leadId || null,
              rawPayload: row.rawPayload
            })),
          { transaction }
        );
      }
    });

    logInfo('Calling leads CSV uploaded', {
      uploadedBy: req.user?.id,
      parsed,
      created,
      skippedDuplicate,
      assigned,
      queued,
      activeLimitPerDealer
    });

    res.status(201).json({
      success: true,
      data: {
        parsed,
        batchId,
        uploadId: batchId,
        fileName: file.originalname || 'upload.csv',
        uploadedBy: req.user?.id || 'unknown',
        created,
        skippedDuplicate,
        assigned,
        queued,
        assignedAtUpload: assigned,
        queuedAtUpload: queued,
        activeLimitPerDealer,
        rowCount: parsed,
        assignedDealers: dealerIds
      }
    });

    emitRealtime(realtimeEvents.callingUploadsUpdated, {
      batchId,
      uploadedAt: new Date().toISOString(),
      assignedDealers: dealerIds
    });
    emitRealtime(realtimeEvents.callingActionsUpdated, {
      source: 'upload-calling-leads',
      at: new Date().toISOString()
    });
  } catch (error) {
    logError('Upload calling leads CSV error', error, { userId: req.user?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

const CALLABLE_QUEUE_STATUSES = ['queued', 'assigned', 'active', 'in_progress'] as const;

const buildCallableQueue = async (dealerId: string, limit = 500) => {
  const now = new Date();

  await sequelize.transaction(async (transaction) => {
    await promoteQueuedLeadIfSlotAvailable(dealerId, DEFAULT_ACTIVE_LIMIT_PER_DEALER, transaction);
  });

  let rows = await DealerLeadAssignment.findAll({
    where: {
      [Op.and]: [
        {
          dealerId,
          [Op.or]: [
            { status: { [Op.in]: [...CALLABLE_QUEUE_STATUSES] } },
            { status: 'rescheduled', nextFollowUpAt: { [Op.lte]: now } }
          ]
        },
        LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE,
        dealerBatchEligibilityClause(dealerId)
      ]
    },
    include: [{ model: CallingLead, as: 'lead' }],
    // Stable FIFO: one sort key (no status-based reorder). queued_at N/A — use assignedAt then createdAt.
    order: [
      [Sequelize.literal('COALESCE("DealerLeadAssignment"."assignedAt", "DealerLeadAssignment"."createdAt")'), 'ASC'],
      ['id', 'ASC']
    ],
    limit
  });

  // Promote from queued pool when no callable rows are present.
  if (!rows.length) {
    await sequelize.transaction(async (transaction) => {
      await promoteQueuedLeadIfSlotAvailable(dealerId, DEFAULT_ACTIVE_LIMIT_PER_DEALER, transaction);
    });
    rows = await DealerLeadAssignment.findAll({
      where: {
        [Op.and]: [
          {
            dealerId,
            [Op.or]: [
              { status: { [Op.in]: [...CALLABLE_QUEUE_STATUSES] } },
              { status: 'rescheduled', nextFollowUpAt: { [Op.lte]: now } }
            ]
          },
          LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE,
          dealerBatchEligibilityClause(dealerId)
        ]
      },
      include: [{ model: CallingLead, as: 'lead' }],
      order: [
        [Sequelize.literal('COALESCE("DealerLeadAssignment"."assignedAt", "DealerLeadAssignment"."createdAt")'), 'ASC'],
        ['id', 'ASC']
      ],
      limit
    });
  }

  const leadIds = rows.map((row: any) => String(row.leadId)).filter(Boolean);
  const latestStatusMap = await buildLatestStatusMetaMap(dealerId, leadIds);

  return rows
    .map((row: any) => {
      const lead = row.lead;
      if (!lead) return null;
      const latestStatus = latestStatusMap.get(String(row.leadId));
      return {
        id: lead.id,
        leadId: lead.id,
        name: lead.name,
        mobile: lead.mobile,
        altMobile: lead.altMobile,
        kNumber: lead.kNumber,
        address: lead.address,
        city: lead.city,
        state: lead.state,
        customerNote: lead.customerNote,
        // Explicit calling assignee (this queue is scoped to `dealerId`; do not infer from lead.uploader fields).
        assignedDealerId: row.dealerId,
        assigned_dealer_id: row.dealerId,
        assignedToDealerId: row.dealerId,
        assigned_to_dealer_id: row.dealerId,
        status: row.status,
        callRemark: row.callRemark,
        statusCategory: latestStatus?.statusCategory || null,
        statusLabel: latestStatus?.statusLabel || null,
        statusReason: latestStatus?.statusReason || null,
        isCustomReason: latestStatus?.isCustomReason || false,
        statusCategoryKey: latestStatus?.statusCategory || null,
        statusCategoryLabel: latestStatus?.statusLabel || null,
        nextFollowUpAt: row.nextFollowUpAt,
        actionAt: row.actionAt
      };
    })
    .filter(Boolean) as any[];
};

const buildDealerQueueCounts = async (dealerId: string) => {
  const [pendingCount, queuedCount, scheduledCount, completedCount] = await Promise.all([
    DealerLeadAssignment.count({
      where: {
        [Op.and]: [
          {
            dealerId,
            status: { [Op.in]: ['active', 'assigned', 'in_progress'] }
          },
          LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE,
          dealerBatchEligibilityClause(dealerId)
        ]
      }
    }),
    DealerLeadAssignment.count({
      where: {
        [Op.and]: [{ dealerId, status: 'queued' }, LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE, dealerBatchEligibilityClause(dealerId)]
      }
    }),
    DealerLeadAssignment.count({
      where: {
        [Op.and]: [{ dealerId, status: 'rescheduled' }, LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE, dealerBatchEligibilityClause(dealerId)]
      }
    }),
    DealerLeadAssignment.count({
      where: {
        [Op.and]: [{ dealerId, status: 'completed' }, LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE, dealerBatchEligibilityClause(dealerId)]
      }
    })
  ]);

  return { pendingCount, queuedCount, scheduledCount, completedCount };
};

const buildScheduledLeads = async (dealerId: string) => {
  const now = new Date();
  const rows = await DealerLeadAssignment.findAll({
    where: {
      [Op.and]: [
        {
          dealerId,
          status: 'rescheduled',
          nextFollowUpAt: { [Op.gt]: now }
        },
        LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE,
        dealerBatchEligibilityClause(dealerId)
      ]
    },
    include: [{ model: CallingLead, as: 'lead' }],
    order: [['nextFollowUpAt', 'ASC'], ['assignedAt', 'ASC']],
    limit: 100
  });
  const leadIds = rows.map((row: any) => String(row.leadId)).filter(Boolean);
  const latestStatusMap = await buildLatestStatusMetaMap(dealerId, leadIds);

  return rows.map((row: any) => ({
    leadId: row.leadId,
    id: row.leadId,
    name: row.lead?.name || '',
    mobile: row.lead?.mobile || '',
    altMobile: row.lead?.altMobile || null,
    kNumber: row.lead?.kNumber || null,
    customerNote: row.lead?.customerNote || null,
    address: row.lead?.address || null,
    city: row.lead?.city || null,
    state: row.lead?.state || null,
    assignedDealerId: row.dealerId,
    assigned_dealer_id: row.dealerId,
    assignedToDealerId: row.dealerId,
    assigned_to_dealer_id: row.dealerId,
    action: row.action,
    actionAt: row.actionAt,
    callRemark: row.callRemark,
    statusCategory: latestStatusMap.get(String(row.leadId))?.statusCategory || null,
    statusLabel: latestStatusMap.get(String(row.leadId))?.statusLabel || null,
    statusReason: latestStatusMap.get(String(row.leadId))?.statusReason || null,
    isCustomReason: latestStatusMap.get(String(row.leadId))?.isCustomReason || false,
    statusCategoryKey: latestStatusMap.get(String(row.leadId))?.statusCategory || null,
    statusCategoryLabel: latestStatusMap.get(String(row.leadId))?.statusLabel || null,
    nextFollowUpAt: row.nextFollowUpAt,
    status: row.status
  }));
};

const getPaginationFromQuery = (req: Request, defaultLimit = 20, maxLimit = 100) => {
  const page = parsePositiveInt(req.query.page, 1);
  const limit = Math.min(parsePositiveInt(req.query.limit, defaultLimit), maxLimit);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

const buildActionSearchWhere = (searchRaw: unknown) => {
  const search = String(searchRaw || '').trim();
  if (!search) return null;
  return {
    [Op.or]: [
      { customerName: { [Op.iLike]: `%${search}%` } },
      { customerMobile: { [Op.iLike]: `%${search}%` } },
      { customerAddress: { [Op.iLike]: `%${search}%` } },
      { statusLabel: { [Op.iLike]: `%${search}%` } },
      { statusReason: { [Op.iLike]: `%${search}%` } },
      { callRemark: { [Op.iLike]: `%${search}%` } }
    ]
  };
};

const buildPagination = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
  hasNext: page < Math.ceil(total / limit),
  hasPrev: page > 1
});

export const getDealerScheduledQueue = async (req: Request, res: Response): Promise<void> => {
  try {
    const dealerId = await resolveDealerIdForQueue(req);
    if (!dealerId) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { page, limit, offset } = getPaginationFromQuery(req, 20, 100);
    const search = String(req.query.search || '').trim();
    const timeFilter = String(req.query.timeFilter || 'all').trim().toLowerCase();
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const next7 = new Date(now);
    next7.setDate(next7.getDate() + 7);
    const next30 = new Date(now);
    next30.setDate(next30.getDate() + 30);

    const whereAnd: any[] = [{ dealerId, status: 'rescheduled' }, LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE];
    if (timeFilter === 'today') {
      whereAnd.push({ nextFollowUpAt: { [Op.gte]: startOfToday, [Op.lte]: endOfToday } });
    } else if (timeFilter === 'next7') {
      whereAnd.push({ nextFollowUpAt: { [Op.gte]: now, [Op.lte]: next7 } });
    } else if (timeFilter === 'next30') {
      whereAnd.push({ nextFollowUpAt: { [Op.gte]: now, [Op.lte]: next30 } });
    }

    const searchOr = search
      ? {
        [Op.or]: [
          { '$lead.name$': { [Op.iLike]: `%${search}%` } },
          { '$lead.mobile$': { [Op.iLike]: `%${search}%` } },
          { '$lead.kNumber$': { [Op.iLike]: `%${search}%` } },
          { '$lead.address$': { [Op.iLike]: `%${search}%` } }
        ]
      }
      : null;
    if (searchOr) whereAnd.push(searchOr);

    const rows = await DealerLeadAssignment.findAndCountAll({
      where: { [Op.and]: whereAnd },
      include: [{ model: CallingLead, as: 'lead' }],
      order: [['nextFollowUpAt', 'ASC'], ['id', 'ASC']],
      limit,
      offset
    });
    const leadIds = rows.rows.map((row: any) => String(row.leadId)).filter(Boolean);
    const latestStatusMap = await buildLatestStatusMetaMap(dealerId, leadIds);
    const items = rows.rows.map((row: any) => ({
      leadId: row.leadId,
      id: row.leadId,
      name: row.lead?.name || '',
      mobile: row.lead?.mobile || '',
      kNumber: row.lead?.kNumber || null,
      address: row.lead?.address || null,
      city: row.lead?.city || null,
      state: row.lead?.state || null,
      nextFollowUpAt: row.nextFollowUpAt,
      actionAt: row.actionAt,
      status: row.status,
      callRemark: row.callRemark,
      statusCategory: latestStatusMap.get(String(row.leadId))?.statusCategory || null,
      statusLabel: latestStatusMap.get(String(row.leadId))?.statusLabel || null,
      statusReason: latestStatusMap.get(String(row.leadId))?.statusReason || null
    }));

    applyNoCacheHeaders(res);
    res.json({
      success: true,
      data: {
        items,
        pagination: buildPagination(page, limit, Number(rows.count || 0))
      }
    });
  } catch (error) {
    logError('Get dealer scheduled queue error', error, { dealerId: req.dealer?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const getDealerDialledActions = async (req: Request, res: Response): Promise<void> => {
  try {
    const dealerId = await resolveDealerIdForQueue(req);
    if (!dealerId) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { page, limit, offset } = getPaginationFromQuery(req, 20, 100);
    const actionFilter = String(req.query.action || 'all').trim().toLowerCase();
    const whereAnd: any[] = [{ dealerId }, { action: { [Op.in]: REPORT_ACTIONS } }];
    if (actionFilter !== 'all' && (REPORT_ACTIONS as readonly string[]).includes(actionFilter)) {
      whereAnd.push({ action: actionFilter });
    }
    const searchWhere = buildActionSearchWhere(req.query.search);
    if (searchWhere) whereAnd.push(searchWhere);

    const rows = await CallingActionHistory.findAndCountAll({
      where: { [Op.and]: whereAnd },
      include: [{ model: CallingLead, as: 'lead' }],
      order: [['actionAt', 'DESC'], ['id', 'DESC']],
      limit,
      offset
    });

    const items = rows.rows.map((row: any) => callingActionToApiJson(row));
    applyNoCacheHeaders(res);
    res.json({
      success: true,
      data: {
        items,
        pagination: buildPagination(page, limit, Number(rows.count || 0))
      }
    });
  } catch (error) {
    logError('Get dealer dialled actions error', error, { dealerId: req.dealer?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

const NOT_CONNECTED_MATCHERS = [
  'call unanswered',
  'switched off',
  'not reachable',
  'busy',
  'line busy',
  'call disconnected',
  'wrong number',
  'invalid number',
  'number does not exist'
];

const buildNotConnectedWhere = () => ({
  [Op.or]: [
    ...NOT_CONNECTED_MATCHERS.map((text) => ({ statusLabel: { [Op.iLike]: `%${text}%` } })),
    ...NOT_CONNECTED_MATCHERS.map((text) => ({ statusReason: { [Op.iLike]: `%${text}%` } })),
    ...NOT_CONNECTED_MATCHERS.map((text) => ({ callRemark: { [Op.iLike]: `%${text}%` } }))
  ]
});

export const getDealerConnectedActions = async (req: Request, res: Response): Promise<void> => {
  try {
    const dealerId = await resolveDealerIdForQueue(req);
    if (!dealerId) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { page, limit, offset } = getPaginationFromQuery(req, 20, 100);
    const outcome = String(req.query.outcome || 'all').trim().toLowerCase();

    const whereAnd: any[] = [
      { dealerId },
      { action: { [Op.in]: REPORT_ACTIONS } },
      { [Op.not]: buildNotConnectedWhere() }
    ];
    if (outcome === 'interested') whereAnd.push({ action: 'called' });
    else if (outcome === 'not_interested') whereAnd.push({ action: 'not_interested' });
    else if (outcome === 'decision_pending') whereAnd.push({ action: { [Op.in]: ['follow_up', 'rescheduled'] } });
    const searchWhere = buildActionSearchWhere(req.query.search);
    if (searchWhere) whereAnd.push(searchWhere);

    const rows = await CallingActionHistory.findAndCountAll({
      where: { [Op.and]: whereAnd },
      include: [{ model: CallingLead, as: 'lead' }],
      order: [['actionAt', 'DESC'], ['id', 'DESC']],
      limit,
      offset
    });
    const items = rows.rows.map((row: any) => callingActionToApiJson(row));

    applyNoCacheHeaders(res);
    res.json({
      success: true,
      data: {
        items,
        pagination: buildPagination(page, limit, Number(rows.count || 0))
      }
    });
  } catch (error) {
    logError('Get dealer connected actions error', error, { dealerId: req.dealer?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const getDealerNotConnectedActions = async (req: Request, res: Response): Promise<void> => {
  try {
    const dealerId = await resolveDealerIdForQueue(req);
    if (!dealerId) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { page, limit, offset } = getPaginationFromQuery(req, 20, 100);
    const reason = String(req.query.reason || 'all').trim();
    const whereAnd: any[] = [
      { dealerId },
      { action: { [Op.in]: REPORT_ACTIONS } },
      buildNotConnectedWhere()
    ];
    if (reason && reason.toLowerCase() !== 'all') {
      whereAnd.push({
        [Op.or]: [
          { statusLabel: { [Op.iLike]: `%${reason}%` } },
          { statusReason: { [Op.iLike]: `%${reason}%` } },
          { callRemark: { [Op.iLike]: `%${reason}%` } }
        ]
      });
    }
    const searchWhere = buildActionSearchWhere(req.query.search);
    if (searchWhere) whereAnd.push(searchWhere);

    const rows = await CallingActionHistory.findAndCountAll({
      where: { [Op.and]: whereAnd },
      include: [{ model: CallingLead, as: 'lead' }],
      order: [['actionAt', 'DESC'], ['id', 'DESC']],
      limit,
      offset
    });
    const items = rows.rows.map((row: any) => callingActionToApiJson(row));

    applyNoCacheHeaders(res);
    res.json({
      success: true,
      data: {
        items,
        pagination: buildPagination(page, limit, Number(rows.count || 0))
      }
    });
  } catch (error) {
    logError('Get dealer not-connected actions error', error, { dealerId: req.dealer?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

const buildRecentActions = async (dealerId: string, limit = 1000) => {
  const rows = await CallingActionHistory.findAll({
    where: {
      dealerId
    },
    include: [{ model: CallingLead, as: 'lead' }],
    order: [['actionAt', 'DESC'], ['createdAt', 'DESC']],
    limit
  });

  // UI requirement: at most ONE recent item per leadId.
  // We return the latest history row per leadId (rows are already sorted DESC).
  const seen = new Set<string>();
  const out: any[] = [];
  for (const row of rows as any[]) {
    const leadId = String(row.leadId);
    if (seen.has(leadId)) continue;
    seen.add(leadId);
    out.push(callingActionToApiJson(row));
    if (out.length >= limit) break;
  }
  return out;
};

const buildDealerQueueSnapshot = async (dealerId: string, recentActionsLimit = 1000) => {
  const [queue, counts, scheduledLeads, recentActions] = await Promise.all([
    buildCallableQueue(dealerId),
    buildDealerQueueCounts(dealerId),
    buildScheduledLeads(dealerId),
    buildRecentActions(dealerId, recentActionsLimit)
  ]);
  const lead = queue.length ? queue[0] : null;

  const dialledActions = recentActions.filter((row: any) =>
    ['called', 'follow_up', 'not_interested', 'rescheduled'].includes(String(row.action || ''))
  );
  const connectedActions = dialledActions.filter((row: any) => classifyActionStage(row) === 'connected');
  const notConnectedActions = dialledActions.filter((row: any) => classifyActionStage(row) === 'not_connected');

  return {
    lead,
    currentLead: lead,
    nextLead: lead,
    queue,
    leads: queue,
    pendingLeads: queue,
    ...counts,
    counts: {
      pending: counts.pendingCount,
      queued: counts.queuedCount,
      scheduled: counts.scheduledCount,
      completed: counts.completedCount
    },
    scheduledLeads,
    recentActions,
    dialledActions,
    connectedActions,
    notConnectedActions,
    // compatibility aliases expected by some frontend paths
    actionHistory: recentActions,
    completedActions: recentActions
  };
};

const buildDealerEligibilityDebugCounts = async (dealerId: string) => {
  // Count eligible unassigned pool leads: no dealer_lead_assignments row,
  // and batch (if any) must include this dealer.
  const unassignedEligiblePoolCount = await CallingLead.count({
    where: Sequelize.literal(`
      NOT EXISTS (
        SELECT 1
        FROM "dealer_lead_assignments" AS da
        WHERE da."leadId" = "CallingLead"."id"
      )
      AND (
        "CallingLead"."batchId" IS NULL
        OR EXISTS (
          SELECT 1
          FROM "calling_lead_upload_batches" AS b
          WHERE b."id" = "CallingLead"."batchId"
            AND ${batchDealerEligibilityPredicate(dealerId, 'b')}
        )
      )
    `)
  });

  // Count eligible reassignable leads from other dealers (queued/assigned/active),
  // so we can detect starvation.
  const otherDealerReassignableCount = await DealerLeadAssignment.count({
    where: {
      [Op.and]: [
        {
          dealerId: { [Op.ne]: dealerId }
        },
        {
          status: { [Op.in]: ['queued', 'assigned', 'active'] }
        },
        LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE,
        dealerBatchEligibilityClause(dealerId)
      ]
    }
  });

  return { unassignedEligiblePoolCount, otherDealerReassignableCount };
};

const applyNoCacheHeaders = (res: Response) => {
  // Calling queue changes frequently; always return fresh payload.
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
};

const resolveDealerIdForQueue = async (req: Request): Promise<string | null> => {
  if (req.dealer?.id) return req.dealer.id;

  const username = (req.user as any)?.username;
  const email = (req.user as any)?.email;
  const mobile = (req.user as any)?.mobile;
  if (!username && !email && !mobile) return null;

  const dealer = await Dealer.findOne({
    attributes: ['id'],
    where: {
      [Op.or]: [
        ...(username ? [{ username }] : []),
        ...(email ? [{ email }] : []),
        ...(mobile ? [{ mobile }] : [])
      ]
    }
  });

  return dealer?.id || null;
};

export const getDealerCallingQueueCurrent = async (req: Request, res: Response): Promise<void> => {
  try {
    const dealerId = await resolveDealerIdForQueue(req);
    if (!dealerId) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const requestedLimit = Number(req.query.limit);
    const recentActionsLimit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(5000, Math.floor(requestedLimit))
        : 1000;

    const debug = String(req.query.debug || '').toLowerCase() === 'true';
    const snapshot = await buildDealerQueueSnapshot(dealerId, recentActionsLimit);
    const debugCounts = debug ? await buildDealerEligibilityDebugCounts(dealerId) : null;
    applyNoCacheHeaders(res);

    res.json({
      success: true,
      data: {
        ...snapshot,
        debugEligibility: debugCounts
      }
    });
  } catch (error) {
    logError('Get dealer calling queue current error', error, { dealerId: req.dealer?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Backward compatible alias
export const getDealerCallingQueueNext = getDealerCallingQueueCurrent;

export const updateDealerCallingQueueAction = async (req: Request, res: Response): Promise<void> => {
  try {
    const dealerId = await resolveDealerIdForQueue(req);
    if (!dealerId) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { leadId } = req.params;
    const requestBody = req.body as Record<string, unknown>;
    const {
      action,
      callRemark,
      nextFollowUpAt,
      actionAt,
      statusCategory,
      statusLabel,
      statusReason,
      isCustomReason,
      statusCategoryKey,
      statusCategoryLabel,
      editMode,
      status_category,
      status_text
    } = requestBody as {
      action: 'start' | 'called' | 'follow_up' | 'not_interested' | 'rescheduled';
      callRemark?: string;
      nextFollowUpAt?: string;
      actionAt?: string;
      statusCategory?: string;
      statusLabel?: string;
      statusReason?: string;
      isCustomReason?: boolean;
      statusCategoryKey?: string;
      statusCategoryLabel?: string;
      editMode?: boolean;
      status_category?: string;
      status_text?: string;
      claim?: boolean | string;
      autoAssign?: boolean | string;
      assignedDealerId?: string;
    };

    const allowClaim = shouldAllowClaimOnAction(action, requestBody);

    const parsed = parseTaggedCallRemark(callRemark ?? null);
    const hasParsedTags = Boolean(parsed.statusCategory || parsed.status);

    const effectiveStatusCategory =
      normalizeStatusCategory(statusCategoryKey) ||
      normalizeStatusCategory(status_category) ||
      normalizeStatusCategory(statusCategory) ||
      normalizeStatusCategory(parsed.statusCategory) ||
      inferStatusCategoryFromRemark(callRemark) ||
      null;
    const effectiveStatusLabel =
      statusCategoryLabel || statusLabel || status_text || parsed.status || null;
    const effectiveStatusReason = (hasParsedTags ? parsed.remark : null) || statusReason || null;
    const legacyCallRemark =
      effectiveStatusCategory && effectiveStatusLabel
        ? `[${effectiveStatusCategory}] ${effectiveStatusLabel}${effectiveStatusReason ? ` | ${effectiveStatusReason}` : ''}`
        : null;

    if (effectiveStatusCategory && !(ALLOWED_STATUS_CATEGORIES as readonly string[]).includes(effectiveStatusCategory)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Validation error',
          details: [{
            field: 'statusCategoryKey',
            message: `Invalid statusCategory. Allowed values: ${ALLOWED_STATUS_CATEGORIES.join(', ')}`
          }]
        }
      });
      return;
    }

    if (action === 'rescheduled' && !nextFollowUpAt) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: 'Validation error', details: [{ field: 'nextFollowUpAt', message: 'nextFollowUpAt is required for rescheduled action' }] }
      });
      return;
    }

    const followUpDate = parseDateSafe(nextFollowUpAt);
    const actionDate = parseDateSafe(actionAt);
    if (action === 'rescheduled' && !followUpDate) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: 'Validation error', details: [{ field: 'nextFollowUpAt', message: 'Invalid datetime format' }] }
      });
      return;
    }
    if (action === 'rescheduled') {
      if (!followUpDate) {
        res.status(400).json({
          success: false,
          error: { code: 'VAL_001', message: 'Validation error', details: [{ field: 'nextFollowUpAt', message: 'Invalid datetime format' }] }
        });
        return;
      }
      if (followUpDate.getTime() <= Date.now()) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_001',
            message: 'Validation error',
            details: [{ field: 'nextFollowUpAt', message: 'nextFollowUpAt must be a future datetime for rescheduled action' }]
          }
        });
        return;
      }
    }

    const requiresManualReason = effectiveStatusReason === 'Others' || isCustomReason === true;
    if (requiresManualReason && (!callRemark || !callRemark.trim())) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Validation error',
          details: [{ field: 'callRemark', message: 'Manual reason is required when statusReason is Others or custom mode is used' }]
        }
      });
      return;
    }

    const OUTCOME_ACTIONS: Array<'called' | 'follow_up' | 'not_interested' | 'rescheduled'> = [
      'called',
      'follow_up',
      'not_interested',
      'rescheduled'
    ];

    const isRescheduledDue = (row: { status: string; nextFollowUpAt?: Date | null }, now: Date) =>
      row.status === 'rescheduled' &&
      Boolean(row.nextFollowUpAt) &&
      new Date(row.nextFollowUpAt as Date).getTime() <= now.getTime();

    let updatedData: any = null;
    await sequelize.transaction(async (transaction) => {
      await promoteQueuedLeadIfSlotAvailable(dealerId, DEFAULT_ACTIVE_LIMIT_PER_DEALER, transaction);

      const assignment = await resolveAssignmentForDealerAction(
        leadId,
        dealerId,
        transaction,
        allowClaim
      );

      const hasStatusUpdatePayload = Boolean(
        callRemark ||
          statusCategory ||
          statusCategoryKey ||
          status_category ||
          statusLabel ||
          statusCategoryLabel ||
          status_text ||
          statusReason ||
          isCustomReason
      );
      const isEditMode = Boolean(editMode) || hasStatusUpdatePayload;
      const canEditCompleted = isEditMode && assignment.status === 'completed' && action !== 'start';

      const effectiveActionAt = actionDate || new Date();
      const effectiveCallRemarkForStart =
        callRemark ?? assignment.callRemark ?? legacyCallRemark ?? null;
      const effectiveCallRemarkForOutcome = callRemark ?? legacyCallRemark ?? null;
      const effectiveNextFollowUpAt = action === 'rescheduled' ? followUpDate : null;

      const upsertActionHistory = async (opts: {
        isEditLatest: boolean;
        historyAction: CallingActionType;
      }) => {
        const { historyAction } = opts;
        const [dealer, lead] = await Promise.all([
          Dealer.findByPk(assignment.dealerId, {
            attributes: ['firstName', 'lastName'],
            transaction
          }),
          CallingLead.findByPk(assignment.leadId, {
            attributes: ['name', 'mobile', 'address', 'city', 'state'],
            transaction
          })
        ]);

        const dealerName = dealer ? `${dealer.firstName || ''} ${dealer.lastName || ''}`.trim() : null;
        const customerName = lead?.name || null;
        const customerMobile = lead?.mobile || null;
        const customerAddress = lead
          ? buildCustomerAddress({
            address: lead.address,
            city: lead.city,
            state: lead.state
          })
          : null;

        const historyPayload = {
          action: historyAction,
          reasonCategory: getReasonCategoryFromAction(historyAction),
          callRemark: effectiveCallRemarkForOutcome,
          statusCategory: effectiveStatusCategory,
          statusLabel: effectiveStatusLabel,
          statusReason: effectiveStatusReason || null,
          isCustomReason: Boolean(isCustomReason),
          actionAt: effectiveActionAt,
          nextFollowUpAt: effectiveNextFollowUpAt,
          customerName,
          customerMobile,
          customerAddress
        };

        if (opts.isEditLatest) {
          const latest = await CallingActionHistory.findOne({
            where: { leadId: assignment.leadId, dealerId: assignment.dealerId },
            order: [['actionAt', 'DESC'], ['createdAt', 'DESC']],
            transaction,
            lock: transaction.LOCK.UPDATE
          });
          if (latest) {
            await latest.update(historyPayload, { transaction });
          } else {
            await CallingActionHistory.create(
              {
                id: uuidv4(),
                leadId: assignment.leadId,
                dealerId: assignment.dealerId,
                dealerName,
                ...historyPayload
              },
              { transaction }
            );
          }
        } else {
          await CallingActionHistory.create(
            {
              id: uuidv4(),
              leadId: assignment.leadId,
              dealerId: assignment.dealerId,
              dealerName,
              ...historyPayload
            },
            { transaction }
          );
        }
      };

      // --- Completed assignment: history-only edit (no assignment transition guard) ---
      if (canEditCompleted) {
        if (!OUTCOME_ACTIONS.includes(action as (typeof OUTCOME_ACTIONS)[number])) {
          const error: any = new Error('INVALID_TRANSITION');
          error.code = 'LEAD_005';
          throw error;
        }
        const historyAction = action as CallingActionType;
        await upsertActionHistory({ isEditLatest: true, historyAction });
        await assignment.reload({ transaction });
        updatedData = {
          leadId: assignment.leadId,
          status: historyAction,
          assignmentStatus: assignment.status,
          action: assignment.action,
          callRemark: assignment.callRemark,
          nextFollowUpAt: assignment.nextFollowUpAt,
          actionAt: assignment.actionAt
        };
        return;
      }

      const now = new Date();

      // --- start: idempotent when already in_progress; allow queued | assigned | active | due rescheduled ---
      if (action === 'start') {
        if (assignment.status === 'in_progress') {
          await assignment.reload({ transaction });
          updatedData = {
            leadId: assignment.leadId,
            status: assignment.status,
            assignmentStatus: assignment.status,
            action: assignment.action,
            callRemark: assignment.callRemark,
            nextFollowUpAt: assignment.nextFollowUpAt,
            actionAt: assignment.actionAt
          };
          return;
        }
        const rescheduledDueForStart = isRescheduledDue(assignment, now);
        if (assignment.status === 'rescheduled' && rescheduledDueForStart) {
          await assignment.update(
            {
              status: 'in_progress',
              action: null,
              callRemark: effectiveCallRemarkForStart,
              actionAt: effectiveActionAt
            },
            { transaction }
          );
          await assignment.reload({ transaction });
          updatedData = {
            leadId: assignment.leadId,
            status: assignment.status,
            assignmentStatus: assignment.status,
            action: assignment.action,
            callRemark: assignment.callRemark,
            nextFollowUpAt: assignment.nextFollowUpAt,
            actionAt: assignment.actionAt
          };
          return;
        }
        if (['queued', 'assigned', 'active'].includes(assignment.status)) {
          await assignment.update(
            {
              status: 'in_progress',
              action: null,
              callRemark: effectiveCallRemarkForStart,
              actionAt: effectiveActionAt
            },
            { transaction }
          );
          await assignment.reload({ transaction });
          updatedData = {
            leadId: assignment.leadId,
            status: assignment.status,
            assignmentStatus: assignment.status,
            action: assignment.action,
            callRemark: assignment.callRemark,
            nextFollowUpAt: assignment.nextFollowUpAt,
            actionAt: assignment.actionAt
          };
          return;
        }
        const error: any = new Error('INVALID_TRANSITION');
        error.code = 'LEAD_005';
        throw error;
      }

      // --- Outcomes: coalesce implicit start from queued | assigned | active ---
      const coalesceImplicitStart =
        OUTCOME_ACTIONS.includes(action) && ['queued', 'assigned', 'active'].includes(assignment.status);
      if (coalesceImplicitStart) {
        await assignment.update(
          {
            status: 'in_progress',
            action: null,
            callRemark: assignment.callRemark,
            actionAt: effectiveActionAt
          },
          { transaction }
        );
        await assignment.reload({ transaction });
      }

      const rescheduledDue = isRescheduledDue(assignment, now);
      const canApplyOutcome =
        assignment.status === 'in_progress' ||
        (assignment.status === 'rescheduled' && (rescheduledDue || action === 'rescheduled'));

      if (!canApplyOutcome) {
        const error: any = new Error('INVALID_TRANSITION');
        error.code = 'LEAD_005';
        throw error;
      }

      if (action === 'rescheduled') {
        await assignment.update(
          {
            status: 'rescheduled',
            action,
            callRemark: effectiveCallRemarkForOutcome,
            nextFollowUpAt: effectiveNextFollowUpAt,
            actionAt: effectiveActionAt
          },
          { transaction }
        );
      } else {
        await assignment.update(
          {
            status: 'completed',
            action,
            callRemark: effectiveCallRemarkForOutcome,
            actionAt: effectiveActionAt
          },
          { transaction }
        );
      }

      await upsertActionHistory({ isEditLatest: false, historyAction: action as CallingActionType });

      await assignment.reload({ transaction });

      if (assignment.status === 'completed') {
        await promoteQueuedLeadIfSlotAvailable(dealerId, DEFAULT_ACTIVE_LIMIT_PER_DEALER, transaction);
      }

      updatedData = {
        leadId: assignment.leadId,
        status: action,
        assignmentStatus: assignment.status,
        action: assignment.action,
        callRemark: assignment.callRemark,
        nextFollowUpAt: assignment.nextFollowUpAt,
        actionAt: assignment.actionAt
      };
    });

    applyNoCacheHeaders(res);
    res.json({
      success: true,
      data: {
        ...updatedData,
        ...(await buildDealerQueueSnapshot(dealerId, 1000))
      }
    });

    if (action !== 'start') {
      emitRealtime(realtimeEvents.callingActionsUpdated, {
        dealerId,
        leadId,
        action,
        actionAt: (updatedData?.actionAt || new Date()).toISOString?.() || new Date().toISOString()
      });
    }
  } catch (error) {
    const errorCode = (error as any)?.code;
    if (errorCode === 'LEAD_004') {
      res.status(403).json({ success: false, error: { code: 'LEAD_004', message: 'Lead not assigned to dealer' } });
      return;
    }
    if (errorCode === 'RES_001') {
      res.status(404).json({ success: false, error: { code: 'RES_001', message: 'Lead not found' } });
      return;
    }
    if (errorCode === 'LEAD_005') {
      res.status(409).json({ success: false, error: { code: 'LEAD_005', message: 'Invalid lead action transition' } });
      return;
    }
    logError('Update dealer calling queue action error', error, {
      dealerId: req.dealer?.id ?? (req.user as any)?.id ?? null,
      leadId: req.params.leadId
    });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const getHrDealersForAssignment = async (req: Request, res: Response): Promise<void> => {
  try {
    const includeInactive = String(req.query.includeInactive || 'true').toLowerCase() === 'true';
    const where: any = { role: 'dealer' };
    if (!includeInactive) {
      where[Op.or] = [{ isActive: true }, { emailVerified: true }];
    }

    const dealers = await Dealer.findAll({
      where,
      attributes: ['id', 'firstName', 'lastName', 'mobile', 'email', 'isActive', 'emailVerified'],
      order: [['firstName', 'ASC'], ['lastName', 'ASC']]
    });

    res.json({
      success: true,
      data: {
        dealers: dealers.map((dealer) => ({
          id: dealer.id,
          firstName: dealer.firstName,
          lastName: dealer.lastName,
          fullName: `${dealer.firstName} ${dealer.lastName}`.trim(),
          mobile: dealer.mobile,
          email: dealer.email,
          isActive: dealer.isActive,
          emailVerified: dealer.emailVerified,
          isApproved: dealer.isActive || dealer.emailVerified
        })),
        total: dealers.length
      }
    });
  } catch (error) {
    logError('Get HR dealers for assignment error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const getHrDealerAssignmentStats = async (_req: Request, res: Response): Promise<void> => {
  try {
    const dealers = await Dealer.findAll({
      where: { role: 'dealer', isActive: true },
      attributes: ['id', 'firstName', 'lastName']
    });

    const counts = await DealerLeadAssignment.findAll({
      attributes: ['dealerId', 'status', [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']],
      group: ['dealerId', 'status']
    });

    const statMap: Record<string, any> = {};
    for (const dealer of dealers) {
      statMap[dealer.id] = {
        dealerId: dealer.id,
        dealerName: `${dealer.firstName} ${dealer.lastName}`.trim(),
        assigned: 0,
        in_progress: 0,
        queued: 0,
        rescheduled: 0,
        completed: 0
      };
    }

    for (const row of counts as any[]) {
      const dealerId = row.get('dealerId');
      const status = row.get('status');
      const count = Number(row.get('count') || 0);
      if (!statMap[dealerId]) continue;
      if (status in statMap[dealerId]) {
        statMap[dealerId][status] = count;
      }
    }

    res.json({
      success: true,
      data: {
        dealers: Object.values(statMap)
      }
    });
  } catch (error) {
    logError('Get HR dealer assignment stats error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const getHrLeadUploadBatches = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, 200), 500);
    const offset = (page - 1) * limit;

    const batches = await CallingLeadUploadBatch.findAndCountAll({
      order: [['uploadedAt', 'DESC'], ['createdAt', 'DESC']],
      limit,
      offset
    });

    const countsByBatch = await buildHrUploadCountsForBatches(
      batches.rows.map((batch) => ({ id: batch.id, rowCount: batch.rowCount }))
    );

    const poolDealerIds = new Set<string>();
    for (const batch of batches.rows) {
      const assignedDealers = Array.isArray(batch.assignedDealers) ? batch.assignedDealers : [];
      for (const dealerId of assignedDealers) {
        poolDealerIds.add(String(dealerId));
      }
    }
    const dealerList = poolDealerIds.size
      ? await Dealer.findAll({
        where: { id: { [Op.in]: Array.from(poolDealerIds) } },
        attributes: ['id', 'firstName', 'lastName']
      })
      : [];
    const dealerById = new Map(
      dealerList.map((dealer) => [
        dealer.id,
        {
          id: dealer.id,
          firstName: dealer.firstName,
          lastName: dealer.lastName
        }
      ])
    );

    const total = batches.count;
    const hrUploadsList = batches.rows.map((batch) => {
      const assignedDealers = Array.isArray(batch.assignedDealers) ? batch.assignedDealers : [];
      const liveCounts = countsByBatch.get(batch.id) || computeHrUploadLeadCounts(batch.rowCount, {
        completedCount: 0,
        assignedCount: 0
      });
      return {
        id: batch.id,
        uploadedAt: batch.uploadedAt,
        fileName: batch.fileName,
        dealerIds: assignedDealers,
        dealers: assignedDealers
          .map((dealerId) => dealerById.get(String(dealerId)))
          .filter((dealer): dealer is { id: string; firstName: string; lastName: string } => Boolean(dealer)),
        ...hrUploadCountsToApi(liveCounts)
      };
    });

    applyNoCacheHeaders(res);
    res.json({
      success: true,
      uploads: hrUploadsList,
      data: {
        batches: batches.rows.map((batch) => {
          const assignedDealers = Array.isArray(batch.assignedDealers) ? batch.assignedDealers : [];
          const liveCounts = countsByBatch.get(batch.id) || computeHrUploadLeadCounts(batch.rowCount, {
            completedCount: 0,
            assignedCount: 0
          });
          return {
            id: batch.id,
            batchId: batch.id,
            fileName: batch.fileName,
            uploadedBy: batch.uploadedBy,
            uploadedAt: batch.uploadedAt,
            dealerIds: assignedDealers,
            assignedDealers,
            dealers: assignedDealers
              .map((dealerId) => dealerById.get(String(dealerId)))
              .filter((dealer): dealer is { id: string; firstName: string; lastName: string } => Boolean(dealer)),
            assignedDealerDetails: assignedDealers.map((dealerId) => ({
              dealerId,
              dealerName: dealerById.has(String(dealerId))
                ? `${dealerById.get(String(dealerId))!.firstName || ''} ${dealerById.get(String(dealerId))!.lastName || ''}`.trim()
                : ''
            })),
            ...hrUploadCountsToApi(liveCounts)
          };
        }),
        uploads: hrUploadsList,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    logError('Get HR lead upload batches error', error, { userId: req.user?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const getHrLeadUploadBatchRows = async (req: Request, res: Response): Promise<void> => {
  try {
    const { batchId } = req.params;
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, 50), 100);
    const offset = (page - 1) * limit;

    const batch = await CallingLeadUploadBatch.findByPk(batchId);
    if (!batch) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Upload batch not found' }
      });
      return;
    }

    const rows = await CallingLeadUploadRow.findAndCountAll({
      where: { batchId },
      order: [['createdAt', 'ASC'], ['id', 'ASC']],
      limit,
      offset
    });
    const fallbackMobiles = Array.from(new Set(
      rows.rows
        .filter((row) => !row.leadId)
        .map((row) => normalizeMobile(row.customerMobile))
        .filter((mobile): mobile is string => Boolean(mobile))
    ));
    const fallbackLeads = fallbackMobiles.length
      ? await CallingLead.findAll({
        where: {
          batchId,
          mobileNormalized: { [Op.in]: fallbackMobiles }
        },
        attributes: ['id', 'mobileNormalized']
      })
      : [];
    const fallbackLeadIdByMobile = new Map<string, string>();
    for (const lead of fallbackLeads as any[]) {
      fallbackLeadIdByMobile.set(String(lead.mobileNormalized), String(lead.id));
    }

    const resolvedLeadIdForRow = (row: CallingLeadUploadRow): string | null => {
      if (row.leadId) return String(row.leadId);
      const mobile = normalizeMobile(row.customerMobile);
      if (!mobile) return null;
      return fallbackLeadIdByMobile.get(mobile) || null;
    };

    const leadIds = Array.from(new Set(
      rows.rows
        .map((row) => resolvedLeadIdForRow(row))
        .filter((leadId): leadId is string => Boolean(leadId))
    ));
    const assignments = leadIds.length
      ? await DealerLeadAssignment.findAll({
        where: {
          leadId: { [Op.in]: leadIds },
          [Op.and]: [LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE]
        },
        attributes: ['leadId', 'dealerId', 'status']
      })
      : [];
    const assignmentByLeadId = new Map<string, DealerLeadAssignment>();
    for (const assignment of assignments) {
      assignmentByLeadId.set(assignment.leadId, assignment);
    }
    const assignedDealers = Array.isArray(batch.assignedDealers) ? batch.assignedDealers : [];
    const dealerIds = Array.from(
      new Set([
        ...assignedDealers.map((dealerId) => String(dealerId)),
        ...assignments.map((assignment) => String(assignment.dealerId))
      ])
    );
    const dealers = dealerIds.length
      ? await Dealer.findAll({
        where: { id: { [Op.in]: dealerIds } },
        attributes: ['id', 'firstName', 'lastName']
      })
      : [];
    const dealerNameMap = new Map<string, string>();
    const dealerById = new Map<string, { id: string; firstName: string; lastName: string }>();
    for (const dealer of dealers) {
      dealerNameMap.set(dealer.id, `${dealer.firstName || ''} ${dealer.lastName || ''}`.trim());
      dealerById.set(dealer.id, {
        id: dealer.id,
        firstName: dealer.firstName,
        lastName: dealer.lastName
      });
    }
    const countsByBatch = await buildHrUploadCountsForBatches([{ id: batch.id, rowCount: batch.rowCount }]);
    const liveCounts = countsByBatch.get(batch.id) || computeHrUploadLeadCounts(batch.rowCount, {
      completedCount: 0,
      assignedCount: 0
    });

    const resolveRowAssignmentStatus = (
      assignment: DealerLeadAssignment | null | undefined
    ): string => {
      if (!assignment) return 'queued';
      return assignment.status || 'queued';
    };

    const resolveRowAssignedDealerId = (
      assignment: DealerLeadAssignment | null | undefined
    ): string | null => {
      if (!assignment) return null;
      return isValidHrCallingAssigneeDealerId(assignment.dealerId) ? String(assignment.dealerId) : null;
    };

    const total = rows.count;
    const normalizedRows = rows.rows.map((row) => {
      const resolvedLeadId = resolvedLeadIdForRow(row);
      const assignment = resolvedLeadId ? assignmentByLeadId.get(resolvedLeadId) : null;
      const assignedDealerId = resolveRowAssignedDealerId(assignment);
      const assignedDealerName = assignedDealerId ? (dealerNameMap.get(String(assignedDealerId)) || null) : null;
      const assignmentStatus = resolveRowAssignmentStatus(assignment);
      const rawPayload = (row.rawPayload || {}) as Record<string, unknown>;
      return {
        id: row.id,
        rowIndex: row.rowIndex,
        name: row.customerName || '',
        mobile: row.customerMobile || '',
        kNumber: String(extractCell(rawPayload, K_NUMBER_KEYS) || '').trim() || null,
        address: row.customerAddress || '',
        city: String(extractCell(rawPayload, CITY_KEYS) || '').trim() || null,
        state: String(extractCell(rawPayload, STATE_KEYS) || '').trim() || null,
        customerName: row.customerName,
        customerMobile: row.customerMobile,
        customerAddress: row.customerAddress,
        status: assignmentStatus,
        leadStatus: assignmentStatus,
        assignedDealerId,
        assignedDealerName,
        assignmentStatus,
        assigned_dealer_id: assignedDealerId,
        assigned_dealer_name: assignedDealerName,
        assignment_status: assignmentStatus,
        leadId: resolvedLeadId || row.leadId,
        rawPayload: row.rawPayload
      };
    });
    const poolDealers = assignedDealers
      .map((dealerId) => dealerById.get(String(dealerId)))
      .filter((dealer): dealer is { id: string; firstName: string; lastName: string } => Boolean(dealer));

    const batchPayload = {
      id: batch.id,
      batchId: batch.id,
      fileName: batch.fileName,
      uploadedBy: batch.uploadedBy,
      uploadedAt: batch.uploadedAt,
      dealerIds: assignedDealers,
      dealers: poolDealers,
      ...hrUploadCountsToApi(liveCounts)
    };

    applyNoCacheHeaders(res);
    res.json({
      success: true,
      batch: batchPayload,
      data: {
        batch: batchPayload,
        rows: normalizedRows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        },
        totalRows: liveCounts.rowCount
      },
      rows: normalizedRows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      },
      totalRows: liveCounts.rowCount
    });
  } catch (error) {
    logError('Get HR lead upload batch rows error', error, {
      userId: req.user?.id,
      batchId: req.params.batchId
    });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const getAdminCallingActions = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await buildCallingActionsResponse(req);
    res.json({
      success: true,
      data
    });
  } catch (error) {
    logError('Get admin calling actions error', error, { userId: req.user?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const getHrCallingActions = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await buildCallingActionsResponse(req);
    res.json({
      success: true,
      data
    });
  } catch (error) {
    logError('Get HR calling actions error', error, { userId: req.user?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};
