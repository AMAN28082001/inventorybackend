import { Request, Response } from 'express';
import { Op, Sequelize, WhereOptions } from 'sequelize';
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
const ACTIVE_STATUSES = ['assigned', 'in_progress'];
// Keep 'active' as backward-compatible read-only support for old rows.
const ACTIONABLE_STATUSES = ['active', 'assigned', 'in_progress', 'rescheduled'];
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
    actionAt: row.actionAt,
    // compatibility
    callRemark: row.callRemark,
    statusLabel: row.statusLabel,
    statusReason: row.statusReason,
    isCustomReason: row.isCustomReason,
    statusCategoryKey: row.statusCategory,
    statusCategoryLabel: row.statusLabel,
    // explicit fields required by frontend
    statusCategory: normalizedCategory,
    status: row.statusLabel || parsed.status || row.status || null,
    remark: row.statusReason || parsed.remark || null,
    // Required by Calling Data > Recent Actions card
    kNumber: row.kNumber ?? row.k_number ?? row.lead?.kNumber ?? row.lead?.k_number ?? null,
    address: row.address ?? row.leadAddress ?? row.lead_address ?? row.lead?.address ?? null,
    nextFollowUpAt: row.nextFollowUpAt,
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
  const requestedRange = String(req.query.range || 'all').toLowerCase();
  const range: CallingActionFilterRange =
    (CALLING_ACTION_FILTER_RANGES as readonly string[]).includes(requestedRange)
      ? (requestedRange as CallingActionFilterRange)
      : 'all';
  const dealerId = req.query.dealerId ? String(req.query.dealerId) : undefined;
  const category = req.query.category ? String(req.query.category).trim() : '';
  const statusCategoryKey = req.query.statusCategoryKey ? String(req.query.statusCategoryKey).trim() : '';
  const reason = req.query.reason ? String(req.query.reason).trim() : '';
  const action = req.query.action ? String(req.query.action).trim() : '';
  const search = req.query.search ? String(req.query.search).trim() : '';
  const dateRange = req.query.dateRange ? String(req.query.dateRange).trim().toLowerCase() : '';
  const startDate = parseDateBoundary(req.query.startDate, 'start');
  const endDate = parseDateBoundary(req.query.endDate, 'end');

  const { rangeStart, rangeEnd } = resolveReportDateRange(range, dateRange, startDate, endDate);

  const filter: WhereOptions = {};
  if (dealerId) {
    (filter as any).dealerId = dealerId;
  }
  if (rangeStart || rangeEnd) {
    (filter as any).actionAt = {};
    if (rangeStart) {
      (filter as any).actionAt[Op.gte] = rangeStart;
    }
    if (rangeEnd) {
      (filter as any).actionAt[Op.lte] = rangeEnd;
    }
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
      actionAt: row.actionAt,
      nextFollowUpAt: row.nextFollowUpAt,
      customerName: row.customerName,
      customerMobile: row.customerMobile,
      customerAddress: row.customerAddress,
      createdAt: row.createdAt
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
  const now = new Date();
  const activeCount = await DealerLeadAssignment.count({
    where: {
      dealerId,
      [Op.or]: [
        { status: { [Op.in]: ACTIVE_STATUSES } },
        { status: 'rescheduled', nextFollowUpAt: { [Op.lte]: now } }
      ]
    },
    transaction
  });

  if (activeCount >= activeLimitPerDealer) return;

  const queued = await DealerLeadAssignment.findOne({
    where: {
      dealerId,
      status: 'queued'
    },
    order: [['assignedAt', 'ASC']],
    transaction,
    lock: transaction.LOCK.UPDATE
  });

  if (!queued) return;

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
    let activeDealerPointer = 0;
    let queuedDealerPointer = 0;

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

      const dealerActiveCount: Record<string, number> = {};
      const counts = await DealerLeadAssignment.findAll({
        attributes: ['dealerId', [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']],
        where: {
          dealerId: { [Op.in]: dealerIds },
          status: { [Op.in]: ACTIVE_STATUSES }
        },
        group: ['dealerId'],
        transaction
      });
      for (const dealerId of dealerIds) dealerActiveCount[dealerId] = 0;
      for (const row of counts as any[]) {
        dealerActiveCount[row.dealerId] = Number(row.get('count') || 0);
      }

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

        // Scheduler-style assignment:
        // 1) Fill active slots dealer-by-dealer (non-interleaved),
        // 2) Then place overflow into queued pool.
        let dealerId = dealerIds[queuedDealerPointer % dealerIds.length];
        let nextStatus: 'assigned' | 'queued' = 'queued';

        const dealerWithCapacityIdx = dealerIds.findIndex((id) => dealerActiveCount[id] < activeLimitPerDealer);
        if (dealerWithCapacityIdx !== -1) {
          while (activeDealerPointer < dealerIds.length && dealerActiveCount[dealerIds[activeDealerPointer]] >= activeLimitPerDealer) {
            activeDealerPointer += 1;
          }
          if (activeDealerPointer >= dealerIds.length) {
            activeDealerPointer = dealerWithCapacityIdx;
          }
          dealerId = dealerIds[activeDealerPointer];
          nextStatus = 'assigned';
        } else {
          queuedDealerPointer += 1;
          nextStatus = 'queued';
        }

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
        if (nextStatus === 'assigned') {
          assigned += 1;
          dealerActiveCount[dealerId] += 1;
          if (dealerActiveCount[dealerId] >= activeLimitPerDealer && dealerIds[activeDealerPointer] === dealerId) {
            activeDealerPointer += 1;
          }
        } else {
          queued += 1;
        }

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
        fileName: file.originalname || 'upload.csv',
        uploadedBy: req.user?.id || 'unknown',
        created,
        skippedDuplicate,
        assigned,
        queued,
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

const buildCurrentLeadResponse = async (dealerId: string) => {
  const now = new Date();
  const sharedInclude = [{ model: CallingLead, as: 'lead' }] as any;

  const pickCurrentAssignment = async (transaction?: any) => (
    await DealerLeadAssignment.findOne({
      where: {
        dealerId,
        status: 'rescheduled',
        nextFollowUpAt: { [Op.lte]: now }
      },
      include: sharedInclude,
      order: [['nextFollowUpAt', 'ASC'], ['assignedAt', 'ASC']],
      transaction
    }) ||
    await DealerLeadAssignment.findOne({
      where: {
        dealerId,
        status: 'in_progress'
      },
      include: sharedInclude,
      order: [['assignedAt', 'ASC']],
      transaction
    }) ||
    await DealerLeadAssignment.findOne({
      where: {
        dealerId,
        status: 'assigned'
      },
      include: sharedInclude,
      order: [['assignedAt', 'ASC']],
      transaction
    })
  );

  // Priority order:
  // 1) due rescheduled leads, 2) in-progress, 3) active, 4) assigned (legacy).
  let assignment = await pickCurrentAssignment();

  // Safety fallback:
  // If dealer has queued work but no active card, promote one queued lead
  // immediately so newly uploaded batches become visible without manual refresh loops.
  if (!assignment) {
    await sequelize.transaction(async (transaction) => {
      await promoteQueuedLeadIfSlotAvailable(dealerId, DEFAULT_ACTIVE_LIMIT_PER_DEALER, transaction);
      assignment = await pickCurrentAssignment(transaction);
    });
  }

  const lead = assignment ? (assignment as any).lead : null;
  if (!assignment || !lead) return null;
  const latestStatusMap = await buildLatestStatusMetaMap(dealerId, [lead.id]);
  const latestStatus = latestStatusMap.get(lead.id);

  return {
    id: lead.id,
    name: lead.name,
    mobile: lead.mobile,
    altMobile: lead.altMobile,
    kNumber: lead.kNumber,
    address: lead.address,
    city: lead.city,
    state: lead.state,
    customerNote: lead.customerNote,
    status: assignment.status,
    callRemark: assignment.callRemark,
    statusCategory: latestStatus?.statusCategory || null,
    statusLabel: latestStatus?.statusLabel || null,
    statusReason: latestStatus?.statusReason || null,
    isCustomReason: latestStatus?.isCustomReason || false,
    statusCategoryKey: latestStatus?.statusCategory || null,
    statusCategoryLabel: latestStatus?.statusLabel || null,
    nextFollowUpAt: assignment.nextFollowUpAt,
    actionAt: assignment.actionAt
  };
};

const buildDealerQueueCounts = async (dealerId: string) => {
  const [pendingCount, queuedCount, scheduledCount, completedCount] = await Promise.all([
    DealerLeadAssignment.count({
      where: {
        dealerId,
        status: { [Op.in]: ['assigned', 'in_progress'] }
      }
    }),
    DealerLeadAssignment.count({
      where: { dealerId, status: 'queued' }
    }),
    DealerLeadAssignment.count({
      where: { dealerId, status: 'rescheduled' }
    }),
    DealerLeadAssignment.count({
      where: { dealerId, status: 'completed' }
    })
  ]);

  return { pendingCount, queuedCount, scheduledCount, completedCount };
};

const buildScheduledLeads = async (dealerId: string) => {
  const now = new Date();
  const rows = await DealerLeadAssignment.findAll({
    where: {
      dealerId,
      status: 'rescheduled',
      nextFollowUpAt: { [Op.gt]: now }
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
  const [lead, counts, scheduledLeads, recentActions] = await Promise.all([
    buildCurrentLeadResponse(dealerId),
    buildDealerQueueCounts(dealerId),
    buildScheduledLeads(dealerId),
    buildRecentActions(dealerId, recentActionsLimit)
  ]);

  const dialledActions = recentActions.filter((row: any) =>
    ['called', 'follow_up', 'not_interested', 'rescheduled'].includes(String(row.action || ''))
  );
  const connectedActions = dialledActions.filter((row: any) => classifyActionStage(row) === 'connected');
  const notConnectedActions = dialledActions.filter((row: any) => classifyActionStage(row) === 'not_connected');

  return {
    lead,
    nextLead: lead,
    ...counts,
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

export const getDealerCallingQueueCurrent = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.dealer) {
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
    const snapshot = await buildDealerQueueSnapshot(req.dealer.id, recentActionsLimit);

    res.json({
      success: true,
      data: snapshot
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
    if (!req.dealer) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const { leadId } = req.params;
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
      editMode
    } = req.body as {
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
    };

    const parsed = parseTaggedCallRemark(callRemark ?? null);
    const hasParsedTags = Boolean(parsed.statusCategory || parsed.status);

    const effectiveStatusCategory =
      normalizeStatusCategory(statusCategoryKey) ||
      normalizeStatusCategory(statusCategory) ||
      normalizeStatusCategory(parsed.statusCategory) ||
      inferStatusCategoryFromRemark(callRemark) ||
      null;
    const effectiveStatusLabel = statusCategoryLabel || statusLabel || parsed.status || null;
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

    let updatedData: any = null;
    await sequelize.transaction(async (transaction) => {
      const assignment = await DealerLeadAssignment.findOne({
        where: {
          leadId,
          dealerId: req.dealer!.id
        },
        transaction,
        lock: transaction.LOCK.UPDATE
      });

      if (!assignment) {
        const error: any = new Error('LEAD_NOT_ASSIGNED');
        error.code = 'LEAD_004';
        throw error;
      }

      const hasStatusUpdatePayload = Boolean(
        callRemark || statusCategory || statusCategoryKey || statusLabel || statusCategoryLabel || statusReason || isCustomReason
      );
      const isEditMode = Boolean(editMode) || hasStatusUpdatePayload;
      const canEditCompleted = isEditMode && assignment.status === 'completed' && action !== 'start';

      if (!ACTIONABLE_STATUSES.includes(assignment.status) && !canEditCompleted) {
        const error: any = new Error('INVALID_TRANSITION');
        error.code = 'LEAD_005';
        throw error;
      }

      const effectiveActionAt = actionDate || new Date();
      const effectiveCallRemark = action === 'start'
        ? (callRemark ?? assignment.callRemark ?? legacyCallRemark ?? null)
        : (callRemark ?? legacyCallRemark ?? null);
      const effectiveNextFollowUpAt = action === 'rescheduled' ? followUpDate : null;
      if (action === 'start') {
        if (!(assignment.status === 'assigned' || assignment.status === 'active')) {
          const error: any = new Error('INVALID_TRANSITION');
          error.code = 'LEAD_005';
          throw error;
        }

        await assignment.update({
          status: 'in_progress',
          action: null,
          callRemark: effectiveCallRemark,
          actionAt: effectiveActionAt
        }, { transaction });
      } else if (action === 'rescheduled') {
        await assignment.update({
          status: 'rescheduled',
          action,
          callRemark: effectiveCallRemark,
          nextFollowUpAt: effectiveNextFollowUpAt,
          actionAt: effectiveActionAt
        }, { transaction });
      } else {
        await assignment.update({
          status: 'completed',
          action,
          callRemark: effectiveCallRemark,
          actionAt: effectiveActionAt
        }, { transaction });
      }

      if (action !== 'start') {
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

        if (canEditCompleted) {
          // Recent Actions edit path: update latest history row for this lead/dealer.
          const latest = await CallingActionHistory.findOne({
            where: { leadId: assignment.leadId, dealerId: assignment.dealerId },
            order: [['actionAt', 'DESC'], ['createdAt', 'DESC']],
            transaction,
            lock: transaction.LOCK.UPDATE
          });
          if (latest) {
            await latest.update({
              action,
              reasonCategory: getReasonCategoryFromAction(action),
              callRemark: effectiveCallRemark,
              statusCategory: effectiveStatusCategory,
              statusLabel: effectiveStatusLabel,
              statusReason: effectiveStatusReason || null,
              isCustomReason: Boolean(isCustomReason),
              actionAt: effectiveActionAt,
              nextFollowUpAt: effectiveNextFollowUpAt,
              customerName,
              customerMobile,
              customerAddress
            }, { transaction });
          } else {
            await CallingActionHistory.create({
              id: uuidv4(),
              leadId: assignment.leadId,
              dealerId: assignment.dealerId,
              dealerName,
              action,
              reasonCategory: getReasonCategoryFromAction(action),
              callRemark: effectiveCallRemark,
              statusCategory: effectiveStatusCategory,
              statusLabel: effectiveStatusLabel,
              statusReason: effectiveStatusReason || null,
              isCustomReason: Boolean(isCustomReason),
              actionAt: effectiveActionAt,
              nextFollowUpAt: effectiveNextFollowUpAt,
              customerName,
              customerMobile,
              customerAddress
            }, { transaction });
          }
        } else {
          await CallingActionHistory.create({
            id: uuidv4(),
            leadId: assignment.leadId,
            dealerId: assignment.dealerId,
            dealerName,
            action,
            reasonCategory: getReasonCategoryFromAction(action),
            callRemark: effectiveCallRemark,
            statusCategory: effectiveStatusCategory,
            statusLabel: effectiveStatusLabel,
            statusReason: effectiveStatusReason || null,
            isCustomReason: Boolean(isCustomReason),
            actionAt: effectiveActionAt,
            nextFollowUpAt: effectiveNextFollowUpAt,
            customerName,
            customerMobile,
            customerAddress
          }, { transaction });
        }
      }
        
      // Refill active slot only when work is completed.
      // Rescheduled leads stay with the same dealer and keep occupying an active slot.
      // Use persisted status check so behavior stays correct even if action labels evolve.
      if (!canEditCompleted && assignment.status === 'completed') {
        await promoteQueuedLeadIfSlotAvailable(req.dealer!.id, DEFAULT_ACTIVE_LIMIT_PER_DEALER, transaction);
      }

      updatedData = {
        leadId: assignment.leadId,
        status: assignment.status,
        action: assignment.action,
        callRemark: assignment.callRemark,
        nextFollowUpAt: assignment.nextFollowUpAt,
        actionAt: assignment.actionAt
      };
    });

    res.json({
      success: true,
      data: {
        ...updatedData,
        ...(await buildDealerQueueSnapshot(req.dealer.id, 1000))
      }
    });

    if (action !== 'start') {
      emitRealtime(realtimeEvents.callingActionsUpdated, {
        dealerId: req.dealer.id,
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
    if (errorCode === 'LEAD_005') {
      res.status(409).json({ success: false, error: { code: 'LEAD_005', message: 'Invalid lead action transition' } });
      return;
    }
    logError('Update dealer calling queue action error', error, {
      dealerId: req.dealer?.id,
      leadId: req.params.leadId
    });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const getHrDealersForAssignment = async (_req: Request, res: Response): Promise<void> => {
  try {
    const dealers = await Dealer.findAll({
      where: {
        role: 'dealer',
        [Op.or]: [
          { isActive: true },
          { emailVerified: true }
        ]
      },
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
    const limit = Math.min(parsePositiveInt(req.query.limit, 50), 500);
    const offset = (page - 1) * limit;

    const batches = await CallingLeadUploadBatch.findAndCountAll({
      order: [['uploadedAt', 'DESC'], ['createdAt', 'DESC']],
      limit,
      offset
    });

    const dealerIds = new Set<string>();
    for (const batch of batches.rows) {
      const assignedDealers = Array.isArray(batch.assignedDealers) ? batch.assignedDealers : [];
      for (const dealerId of assignedDealers) {
        dealerIds.add(String(dealerId));
      }
    }

    const dealerList = dealerIds.size
      ? await Dealer.findAll({
        where: { id: { [Op.in]: Array.from(dealerIds) } },
        attributes: ['id', 'firstName', 'lastName']
      })
      : [];
    const dealerNameMap = new Map<string, string>();
    for (const dealer of dealerList) {
      dealerNameMap.set(dealer.id, `${dealer.firstName || ''} ${dealer.lastName || ''}`.trim());
    }

    const batchIds = batches.rows.map((batch) => batch.id);
    const uploadRows = batchIds.length
      ? await CallingLeadUploadRow.findAll({
        where: { batchId: { [Op.in]: batchIds } },
        order: [['rowIndex', 'ASC']]
      })
      : [];
    const rowsByBatch = new Map<string, CallingLeadUploadRow[]>();
    for (const row of uploadRows) {
      const list = rowsByBatch.get(row.batchId) || [];
      list.push(row);
      rowsByBatch.set(row.batchId, list);
    }

    const total = batches.count;
    res.json({
      success: true,
      data: {
        batches: batches.rows.map((batch) => {
          const assignedDealers = Array.isArray(batch.assignedDealers) ? batch.assignedDealers : [];
          const rows = (rowsByBatch.get(batch.id) || []).map((row) => {
            const rawPayload = (row.rawPayload || {}) as Record<string, unknown>;
            const kNumber = String(extractCell(rawPayload, K_NUMBER_KEYS) || '').trim() || null;
            return {
              id: row.id,
              rowIndex: row.rowIndex,
              // normalized keys for Uploaded Data table rendering
              name: row.customerName || '',
              mobile: row.customerMobile || '',
              kNumber,
              address: row.customerAddress || '',
              // backward-compatible keys
              customerName: row.customerName,
              customerMobile: row.customerMobile,
              customerAddress: row.customerAddress,
              status: row.status,
              leadId: row.leadId,
              rawPayload: row.rawPayload
            };
          });
          return {
            id: batch.id,
            batchId: batch.id,
            fileName: batch.fileName,
            uploadedBy: batch.uploadedBy,
            uploadedAt: batch.uploadedAt,
            rowCount: batch.rowCount,
            assignedDealers,
            assignedDealerDetails: assignedDealers.map((dealerId) => ({
              dealerId,
              dealerName: dealerNameMap.get(String(dealerId)) || ''
            })),
            rows
          };
        }),
        uploads: batches.rows.map((batch) => {
          const assignedDealers = Array.isArray(batch.assignedDealers) ? batch.assignedDealers : [];
          return {
            id: batch.id,
            uploadedAt: batch.uploadedAt,
            fileName: batch.fileName,
            rowCount: batch.rowCount,
            dealerIds: assignedDealers,
            rows: (rowsByBatch.get(batch.id) || []).map((row) => {
              const rawPayload = (row.rawPayload || {}) as Record<string, unknown>;
              return {
                id: row.id,
                name: row.customerName || '',
                mobile: row.customerMobile || '',
                altMobile: String(extractCell(rawPayload, ALT_MOBILE_KEYS) || '').trim() || null,
                kNumber: String(extractCell(rawPayload, K_NUMBER_KEYS) || '').trim() || null,
                address: row.customerAddress || '',
                city: String(extractCell(rawPayload, CITY_KEYS) || '').trim() || null,
                state: String(extractCell(rawPayload, STATE_KEYS) || '').trim() || null,
                customerNote: String(extractCell(rawPayload, NOTE_KEYS) || '').trim() || null,
                assignedDealerId: null,
                status: row.status
              };
            })
          };
        }),
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
    const limit = Math.min(parsePositiveInt(req.query.limit, 100), 500);
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
      order: [['rowIndex', 'ASC']],
      limit,
      offset
    });

    const total = rows.count;
    res.json({
      success: true,
      data: {
        batch: {
          id: batch.id,
          batchId: batch.id,
          fileName: batch.fileName,
          uploadedBy: batch.uploadedBy,
          uploadedAt: batch.uploadedAt,
          rowCount: batch.rowCount,
          assignedDealers: batch.assignedDealers
        },
        rows: rows.rows.map((row) => ({
          id: row.id,
          rowIndex: row.rowIndex,
          customerName: row.customerName,
          customerMobile: row.customerMobile,
          customerAddress: row.customerAddress,
          status: row.status,
          leadId: row.leadId,
          rawPayload: row.rawPayload
        })),
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
