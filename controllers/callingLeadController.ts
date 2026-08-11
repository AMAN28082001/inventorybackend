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
import {
  classifyCallingActionSummaryBucket,
  inferReasonCategoryFromOutcome,
  resolveCallingActionStatusText
} from '../utils/callingActionSummary';

const MOBILE_KEYS = ['mobile', 'phone', 'contact', 'contact no', 'contact no.', 'contactnumber', 'phone_number', 'phone number', 'mobile number'];
const NAME_KEYS = ['name', 'customername', 'customer name', 'full name'];
const ALT_MOBILE_KEYS = ['altmobile', 'alternate mobile', 'alternate_mobile', 'secondary mobile'];
const K_NUMBER_KEYS = ['k number', 'knumber', 'k_number', 'k no', 'kno'];
const ADDRESS_KEYS = ['address'];
const CITY_KEYS = ['city'];
const STATE_KEYS = ['state', 'data ref. / state', 'data ref/state', 'data ref state'];
const NOTE_KEYS = ['customernote', 'customer note', 'note', 'notes', 'remark', 'remarks'];
const DEFAULT_ACTIVE_LIMIT_PER_DEALER = Number(process.env.ACTIVE_LIMIT_PER_DEALER || 1);
/** Hours after which stuck assigned/in_progress leads return to the unassigned pool (§15). */
const CALLING_STUCK_RECLAIM_HOURS = Math.max(
  1,
  Number(process.env.CALLING_STUCK_ASSIGNMENT_HOURS || process.env.CALLING_IN_PROGRESS_TIMEOUT_HOURS || 4)
);
const POOL_UNASSIGNED_DEALER_ID = 'unassigned';
const CALLING_ACTION_FILTER_RANGES = ['daily', 'weekly', 'monthly', 'last_month', 'custom', 'all'] as const;
const REPORT_ACTIONS = ['called', 'follow_up', 'not_interested', 'rescheduled'] as const;
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
const STATUS_CATEGORY_ALIASES: Record<string, (typeof ALLOWED_STATUS_CATEGORIES)[number]> = {
  'Part 1 — Call & lead quality': 'part_1_call_and_lead',
  'Part 2 — Interest & qualification': 'part_2_interest_and_qualification',
  'Part 3 — Follow-up & sales': 'part_3_follow_up_and_sales',
  'Part 4 — Rejection / lost': 'part_4_rejection_lost',
  call_connectivity: 'call_connectivity',
  lead_validity: 'lead_validity',
  customer_intent: 'customer_intent',
  financial: 'financial',
  competition: 'competition',
  schedule: 'schedule',
  other: 'other'
};
const DATE_RANGE_ALIASES = ['today', 'week', 'month', 'custom'] as const;
const CALLING_DEALERS_CACHE_TTL_MS = 60 * 1000;

let cachedActiveDealers: Array<{ id: string; firstName: string; lastName: string }> | null = null;
let cachedActiveDealersExpiresAt = 0;

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
  /** CSV rows parsed at upload (what HR expects for “Rows”). */
  rowCount: number;
  /** Leads actually created in calling_leads for this batch. */
  leadCount: number;
  /** Duplicate/invalid CSV rows not turned into leads. */
  skippedDuplicate: number;
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

export const isPoolOrUnassignedAssigneeId = (dealerId: string | null | undefined): boolean =>
  !isValidHrCallingAssigneeDealerId(dealerId);

const normalizeActiveLimitPerDealer = (raw: unknown): number => {
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return Math.max(1, DEFAULT_ACTIVE_LIMIT_PER_DEALER || 1);
};

/**
 * dealer_lead_assignments.dealerId has FK → dealers(id) and is NOT NULL.
 * Pool/unassigned leads must use a real dealers row with id = "unassigned".
 * Without this, reclaim + overflow upload silently fail (FK violation).
 */
const ensureCallingPoolDealerExists = async (transaction?: any): Promise<void> => {
  const existing = await Dealer.findByPk(POOL_UNASSIGNED_DEALER_ID, {
    attributes: ['id'],
    transaction
  });
  if (existing) return;

  try {
    await Dealer.create(
      {
        id: POOL_UNASSIGNED_DEALER_ID,
        username: '__calling_pool_unassigned__',
        // Locked sentinel — isActive=false; never used for login.
        password: '!calling-pool-locked!',
        firstName: 'Unassigned',
        lastName: 'Pool',
        email: 'calling-pool-unassigned@internal.invalid',
        mobile: '0000000001',
        company: 'SYSTEM',
        gender: 'Other',
        dateOfBirth: new Date('1970-01-01'),
        fatherName: 'SYSTEM',
        fatherContact: '0000000001',
        governmentIdType: 'Passport',
        governmentIdNumber: 'CALLING-POOL-UNASSIGNED',
        addressStreet: 'SYSTEM',
        addressCity: 'SYSTEM',
        addressState: 'SYSTEM',
        addressPincode: '000000',
        role: 'dealer',
        isActive: false,
        emailVerified: false
      },
      { transaction }
    );
    logInfo('Created calling pool dealer sentinel', { dealerId: POOL_UNASSIGNED_DEALER_ID });
  } catch (error) {
    const again = await Dealer.findByPk(POOL_UNASSIGNED_DEALER_ID, {
      attributes: ['id'],
      transaction
    });
    if (again) return;
    throw error;
  }
};

/**
 * §15 — reclaim stuck assigned / in_progress back to the FIFO pool so Assigned can drain to 0.
 * Uses COALESCE(actionAt, updatedAt, assignedAt) older than CALLING_STUCK_RECLAIM_HOURS.
 * Never throws — allocation must survive reclaim failures.
 */
const reclaimStuckCallingAssignments = async (transaction: any): Promise<number> => {
  try {
    await ensureCallingPoolDealerExists(transaction);

    const cutoff = new Date(Date.now() - CALLING_STUCK_RECLAIM_HOURS * 60 * 60 * 1000);
    const sentinels = Array.from(HR_UPLOAD_UNASSIGNED_DEALER_SENTINELS)
      .map((value) => `'${value.replace(/'/g, "''")}'`)
      .join(', ');

    const [, meta] = await sequelize.query(
      `
      UPDATE "dealer_lead_assignments" AS dla
      SET
        "dealerId" = :poolDealerId,
        "status" = 'queued',
        "assignedAt" = NOW(),
        "action" = NULL,
        "callRemark" = NULL,
        "nextFollowUpAt" = NULL,
        "actionAt" = NULL,
        "updatedAt" = NOW()
      WHERE dla."id" IN (
        SELECT stuck."id"
        FROM "dealer_lead_assignments" AS stuck
        WHERE stuck."status" IN ('assigned', 'active', 'in_progress')
          AND LOWER(TRIM(stuck."dealerId")) NOT IN (${sentinels})
          AND COALESCE(stuck."actionAt", stuck."updatedAt", stuck."assignedAt") < :cutoff
          AND NOT EXISTS (
            SELECT 1
            FROM "dealer_lead_assignments" AS newer
            WHERE newer."leadId" = stuck."leadId"
              AND (
                newer."assignedAt" > stuck."assignedAt"
                OR (
                  newer."assignedAt" = stuck."assignedAt"
                  AND newer."createdAt" > stuck."createdAt"
                )
              )
          )
        ORDER BY stuck."assignedAt" ASC
        LIMIT 200
        FOR UPDATE SKIP LOCKED
      )
      `,
      {
        replacements: {
          poolDealerId: POOL_UNASSIGNED_DEALER_ID,
          cutoff
        },
        transaction
      }
    );
    const updated = Number((meta as any)?.rowCount ?? 0);
    return Number.isFinite(updated) ? updated : 0;
  } catch (error) {
    logError('Reclaim stuck calling assignments failed (non-fatal)', error);
    return 0;
  }
};

const countDealerOpenCallingSlots = async (
  dealerId: string,
  transaction: any
): Promise<number> =>
  DealerLeadAssignment.count({
    where: {
      [Op.and]: [
        {
          dealerId,
          status: { [Op.in]: ['assigned', 'active', 'in_progress'] }
        },
        LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE,
        dealerBatchEligibilityClause(dealerId)
      ]
    },
    transaction
  });

/**
 * Live batch buckets (§7.8):
 *   completed  — finished calls + rescheduled follow-ups (not in the active queue)
 *   assigned   — only open callable work (assigned / in_progress / active / dealer-owned queued)
 *   unassigned — residual (pool / no assignee)
 * Invariant: assignedCount + unassignedCount + completedCount === leadCount
 *   (leadCount may be < uploaded CSV rowCount when duplicates were skipped).
 *
 * Rescheduled must NOT inflate Assigned (HR wants Assigned→0 when only follow-ups remain).
 */
export const computeHrUploadLeadCounts = (
  uploadedRowCount: number,
  leadBuckets: { leadCount: number; completedCount: number; assignedCount: number; skippedDuplicate?: number }
): HrUploadLeadCounts => {
  const leadCount = Math.max(0, leadBuckets.leadCount);
  const completedCount = Math.max(0, leadBuckets.completedCount);
  const assignedCount = Math.max(0, leadBuckets.assignedCount);
  const uploaded = Math.max(0, uploadedRowCount);
  const unassignedCount = Math.max(0, leadCount - completedCount - assignedCount);
  const skippedDuplicate =
    leadBuckets.skippedDuplicate !== undefined
      ? Math.max(0, leadBuckets.skippedDuplicate)
      : Math.max(0, uploaded - leadCount);
  return {
    rowCount: uploaded > 0 ? uploaded : leadCount,
    leadCount,
    skippedDuplicate,
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

type HrUploadAuditCountRow = {
  batchId: string;
  duplicateCount: number;
  invalidCount: number;
  auditTotal: number;
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
          WHEN LOWER(COALESCE(dla."status"::text, '')) IN (
            'completed', 'done', 'closed', 'rescheduled'
          ) THEN 1
          ELSE 0
        END
      )::int AS "completedCount",
      SUM(
        CASE
          WHEN LOWER(COALESCE(dla."status"::text, '')) IN (
            'assigned', 'in_progress', 'active', 'queued'
          )
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

const fetchHrUploadAuditCountRows = async (batchIds: string[]): Promise<Map<string, HrUploadAuditCountRow>> => {
  if (!batchIds.length) return new Map();
  try {
    const rows = await sequelize.query<HrUploadAuditCountRow>(
      `
      SELECT
        "batchId" AS "batchId",
        COUNT(*)::int AS "auditTotal",
        SUM(
          CASE WHEN LOWER(COALESCE(status::text, '')) = 'duplicate' THEN 1 ELSE 0 END
        )::int AS "duplicateCount",
        SUM(
          CASE WHEN LOWER(COALESCE(status::text, '')) = 'invalid' THEN 1 ELSE 0 END
        )::int AS "invalidCount"
      FROM "calling_lead_upload_rows"
      WHERE "batchId" IN (:batchIds)
      GROUP BY "batchId"
      `,
      {
        replacements: { batchIds },
        type: QueryTypes.SELECT
      }
    );
    const map = new Map<string, HrUploadAuditCountRow>();
    for (const row of rows) {
      map.set(String(row.batchId), {
        batchId: String(row.batchId),
        auditTotal: Number(row.auditTotal) || 0,
        duplicateCount: Number(row.duplicateCount) || 0,
        invalidCount: Number(row.invalidCount) || 0
      });
    }
    return map;
  } catch (error) {
    logError('fetchHrUploadAuditCountRows failed (non-fatal)', error);
    return new Map();
  }
};

const buildHrUploadCountsForBatches = async (
  batches: Array<{ id: string; rowCount: number }>
): Promise<Map<string, HrUploadLeadCounts>> => {
  const batchIds = batches.map((batch) => batch.id);
  const [aggregateByBatch, auditByBatch] = await Promise.all([
    fetchHrUploadBatchCountRows(batchIds),
    fetchHrUploadAuditCountRows(batchIds)
  ]);
  const countsByBatch = new Map<string, HrUploadLeadCounts>();

  for (const batch of batches) {
    const aggregate = aggregateByBatch.get(batch.id);
    const audit = auditByBatch.get(batch.id);
    const liveLeadCount = Number(aggregate?.leadCount) || 0;
    // Prefer audit total / stored batch.rowCount as uploaded CSV size.
    const uploadedRowCount =
      (audit && audit.auditTotal > 0 ? audit.auditTotal : 0) ||
      Math.max(0, Number(batch.rowCount) || 0) ||
      liveLeadCount;
    const skippedDuplicate =
      (audit ? audit.duplicateCount + audit.invalidCount : 0) ||
      Math.max(0, uploadedRowCount - liveLeadCount);

    countsByBatch.set(
      batch.id,
      computeHrUploadLeadCounts(uploadedRowCount, {
        leadCount: liveLeadCount > 0 ? liveLeadCount : Math.max(0, uploadedRowCount - skippedDuplicate),
        completedCount: aggregate?.completedCount ?? 0,
        assignedCount: aggregate?.assignedCount ?? 0,
        skippedDuplicate
      })
    );
  }

  return countsByBatch;
};

const emptyHrUploadLeadCounts = (uploadedRowCount = 0): HrUploadLeadCounts =>
  computeHrUploadLeadCounts(uploadedRowCount, {
    leadCount: 0,
    completedCount: 0,
    assignedCount: 0,
    skippedDuplicate: 0
  });

const hrUploadCountsToApi = (counts: HrUploadLeadCounts) => ({
  // Rows label = CSV uploaded size (e.g. 2600 for “2401 to 5K”)
  rowCount: counts.rowCount,
  uploadedRowCount: counts.rowCount,
  leadCount: counts.leadCount,
  createdCount: counts.leadCount,
  skippedDuplicate: counts.skippedDuplicate,
  assignedCount: counts.assignedCount,
  unassignedCount: counts.unassignedCount,
  completedCount: counts.completedCount,
  counts: {
    assigned: counts.assignedCount,
    unassigned: counts.unassignedCount,
    completed: counts.completedCount,
    leads: counts.leadCount,
    uploaded: counts.rowCount,
    skippedDuplicate: counts.skippedDuplicate
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

/** Digits for HR mobile search (last-10 when longer; keep shorter for contains/ends-with). */
const extractMobileSearchNeedle = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
};

const resolveHrMobileSearchQuery = (query: Record<string, unknown> | any): string | null =>
  extractMobileSearchNeedle(query?.mobile ?? query?.q ?? query?.search);

/** SQL predicate: last-10 of mobile / altMobile / mobileNormalized contains or ends-with needle. */
const callingLeadMobileSearchSql = (leadAlias: string, needleParam: string) => `
  (
    RIGHT(regexp_replace(COALESCE(${leadAlias}."mobile", ''), '[^0-9]', '', 'g'), 10)
      LIKE '%' || ${needleParam} || '%'
    OR RIGHT(regexp_replace(COALESCE(${leadAlias}."altMobile", ''), '[^0-9]', '', 'g'), 10)
      LIKE '%' || ${needleParam} || '%'
    OR COALESCE(${leadAlias}."mobileNormalized", '') LIKE '%' || ${needleParam} || '%'
  )
`;


const parseDealerIds = (dealerIds: unknown): string[] => {
  if (Array.isArray(dealerIds)) {
    return dealerIds.map((id) => String(id).trim()).filter(Boolean);
  }
  if (dealerIds === undefined || dealerIds === null) return [];
  const raw = String(dealerIds).trim();
  if (!raw) return [];
  // SPA may send dealerIds as a JSON array string
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((id) => String(id).trim()).filter(Boolean);
      }
    } catch {
      /* fall through */
    }
  }
  if (raw.includes(',')) {
    return raw
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  }
  return [raw];
};

/** §15-C-2 — chunk size for large CSV insert/assign (avoids timeout → 500). */
const UPLOAD_INSERT_CHUNK_SIZE = 500;

const truncateErrorMessage = (error: unknown, maxLen = 240): string => {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : error && typeof error === 'object' && 'message' in error
          ? String((error as any).message)
          : 'Internal server error';
  const clean = String(raw || 'Internal server error').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Internal server error';
  return clean.length > maxLen ? `${clean.slice(0, maxLen)}…` : clean;
};

const isUniqueConstraintError = (error: unknown): boolean => {
  const code = String((error as any)?.original?.code || (error as any)?.parent?.code || '');
  const name = String((error as any)?.name || '');
  const message = truncateErrorMessage(error).toLowerCase();
  return (
    code === '23505' ||
    name === 'SequelizeUniqueConstraintError' ||
    message.includes('unique') ||
    message.includes('duplicate key')
  );
};

/** §15-C — SPA sends assignmentMode=round_robin_all to assign every upload row (no active-cap leftovers). */
const isRoundRobinAllAssignmentMode = (raw: unknown): boolean => {
  const mode = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  return (
    mode === 'round_robin_all' ||
    mode === 'roundrobin_all' ||
    mode === 'all' ||
    mode === 'assign_all'
  );
};

const extractDealerIdsFromBatchPool = (assignedDealers: unknown): string[] => {
  if (!Array.isArray(assignedDealers)) return [];
  const ids: string[] = [];
  for (const entry of assignedDealers) {
    if (typeof entry === 'string' || typeof entry === 'number') {
      const id = String(entry).trim();
      if (id) ids.push(id);
      continue;
    }
    if (entry && typeof entry === 'object') {
      const obj = entry as Record<string, unknown>;
      const id = String(obj.id ?? obj.dealerId ?? obj.dealer_id ?? '').trim();
      if (id) ids.push(id);
    }
  }
  return Array.from(new Set(ids));
};

/**
 * §15-C / §15-D — active_cap assign for one upload batch.
 * - rebalance: keep oldest N open Assigned/in_progress per dealer; excess → pool (Unassigned)
 * - top-up: fill dealers under cap from Unassigned (oldest first)
 * Returns { assigned, released }. Never dumps every row (unlike round_robin_all).
 */
const activeCapAssignUnassignedLeadsForBatch = async ({
  batchId,
  dealerIds,
  assignedByUserId,
  activeLimit,
  rebalance,
  transaction
}: {
  batchId: string;
  dealerIds: string[];
  assignedByUserId: string;
  activeLimit: number;
  rebalance: boolean;
  transaction: any;
}): Promise<{ assigned: number; released: number }> => {
  if (!dealerIds.length) return { assigned: 0, released: 0 };
  const limit = Math.max(1, Math.min(50, Math.floor(activeLimit) || 1));
  const safeBatchId = batchId.replace(/'/g, "''");
  const now = new Date();
  let released = 0;
  let assigned = 0;

  await ensureCallingPoolDealerExists(transaction);

  const batchLeadClause = Sequelize.literal(`
    EXISTS (
      SELECT 1 FROM "calling_leads" AS cl
      WHERE cl."id" = "DealerLeadAssignment"."leadId"
        AND cl."batchId" = '${safeBatchId}'
    )
  `);

  const openStatuses = ['assigned', 'active', 'in_progress'] as const;

  // Open Assigned/in_progress for pool dealers on this batch (latest ownership only)
  const openAssignments = await DealerLeadAssignment.findAll({
    where: {
      [Op.and]: [
        { dealerId: { [Op.in]: dealerIds } },
        { status: { [Op.in]: [...openStatuses] } },
        LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE,
        batchLeadClause
      ]
    },
    order: [
      [Sequelize.literal('COALESCE("DealerLeadAssignment"."assignedAt", "DealerLeadAssignment"."createdAt")'), 'ASC'],
      ['id', 'ASC']
    ],
    transaction,
    lock: transaction.LOCK.UPDATE
  });

  const openByDealer = new Map<string, typeof openAssignments>();
  for (const id of dealerIds) openByDealer.set(id, []);
  for (const row of openAssignments) {
    const list = openByDealer.get(String(row.dealerId));
    if (list) list.push(row);
  }

  if (rebalance) {
    const excessIds: string[] = [];
    for (const dealerId of dealerIds) {
      const open = openByDealer.get(dealerId) || [];
      const keep = open.slice(0, limit);
      const excess = open.slice(limit);
      openByDealer.set(dealerId, keep);
      for (const row of excess) {
        excessIds.push(String(row.id));
      }
    }
    if (excessIds.length) {
      // Bulk demote — Manage dealers can release thousands of over-cap Assigned rows.
      const chunkSize = 500;
      for (let i = 0; i < excessIds.length; i += chunkSize) {
        const chunk = excessIds.slice(i, i + chunkSize);
        await sequelize.query(
          `
          UPDATE "dealer_lead_assignments"
          SET
            "dealerId" = :poolDealerId,
            "status" = 'queued',
            "assignedAt" = NOW(),
            "action" = NULL,
            "callRemark" = NULL,
            "nextFollowUpAt" = NULL,
            "actionAt" = NULL,
            "updatedAt" = NOW()
          WHERE "id" IN (:excessIds)
          `,
          {
            replacements: {
              poolDealerId: POOL_UNASSIGNED_DEALER_ID,
              excessIds: chunk
            },
            transaction
          }
        );
      }
      released = excessIds.length;
    }
  }

  const openCount = new Map<string, number>();
  for (const dealerId of dealerIds) {
    openCount.set(dealerId, (openByDealer.get(dealerId) || []).length);
  }

  const sentinels = Array.from(HR_UPLOAD_UNASSIGNED_DEALER_SENTINELS)
    .map((value) => `'${value.replace(/'/g, "''")}'`)
    .join(', ');

  // Unassigned / pool assignments for this batch — oldest first
  const poolAssignments = await DealerLeadAssignment.findAll({
    where: {
      [Op.and]: [
        LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE,
        Sequelize.literal(`LOWER(TRIM("DealerLeadAssignment"."dealerId")) IN (${sentinels})`),
        batchLeadClause,
        { status: { [Op.in]: ['queued', 'assigned', 'active'] } }
      ]
    },
    order: [
      [Sequelize.literal('COALESCE("DealerLeadAssignment"."assignedAt", "DealerLeadAssignment"."createdAt")'), 'ASC'],
      ['id', 'ASC']
    ],
    transaction,
    lock: transaction.LOCK.UPDATE
  });

  // Leads in batch with no assignment row
  const leadsWithoutAssignment = await CallingLead.findAll({
    where: {
      batchId,
      [Op.and]: [
        Sequelize.literal(`
          NOT EXISTS (
            SELECT 1 FROM "dealer_lead_assignments" AS da
            WHERE da."leadId" = "CallingLead"."id"
          )
        `)
      ]
    },
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
    transaction,
    lock: transaction.LOCK.UPDATE
  });

  type Pending =
    | { kind: 'assignment'; row: (typeof poolAssignments)[number] }
    | { kind: 'lead'; lead: (typeof leadsWithoutAssignment)[number] };

  const pending: Pending[] = [
    ...poolAssignments.map((row) => ({ kind: 'assignment' as const, row })),
    ...leadsWithoutAssignment.map((lead) => ({ kind: 'lead' as const, lead }))
  ];

  let cursor = 0;
  for (const item of pending) {
    let picked: string | null = null;
    for (let i = 0; i < dealerIds.length; i += 1) {
      const idx = (cursor + i) % dealerIds.length;
      const dealerId = dealerIds[idx];
      if ((openCount.get(dealerId) || 0) < limit) {
        picked = dealerId;
        cursor = idx + 1;
        break;
      }
    }
    if (!picked) break;

    if (item.kind === 'assignment') {
      await item.row.update(
        {
          dealerId: picked,
          status: 'assigned',
          assignedAt: now,
          action: null,
          callRemark: null,
          nextFollowUpAt: null,
          actionAt: null
        },
        { transaction }
      );
    } else {
      await DealerLeadAssignment.create(
        {
          id: uuidv4(),
          leadId: item.lead.id,
          dealerId: picked,
          assignedBy: assignedByUserId,
          assignedAt: now,
          status: 'assigned'
        },
        { transaction }
      );
    }
    openCount.set(picked, (openCount.get(picked) || 0) + 1);
    assigned += 1;
  }

  return { assigned, released };
};

/**
 * §15-C — round-robin assign all unassigned/pool leads in a batch to dealerIds.
 * Returns how many leads were moved to assigned.
 * Prefer activeCapAssignUnassignedLeadsForBatch for Manage dealers (active_cap).
 */
const roundRobinAssignUnassignedLeadsForBatch = async ({
  batchId,
  dealerIds,
  assignedByUserId,
  transaction
}: {
  batchId: string;
  dealerIds: string[];
  assignedByUserId: string;
  transaction: any;
}): Promise<number> => {
  if (!dealerIds.length) return 0;

  const sentinels = Array.from(HR_UPLOAD_UNASSIGNED_DEALER_SENTINELS)
    .map((value) => `'${value.replace(/'/g, "''")}'`)
    .join(', ');

  // Pool / sentinel assignments (latest per lead) for this batch — oldest first
  const poolAssignments = await DealerLeadAssignment.findAll({
    where: {
      [Op.and]: [
        LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE,
        Sequelize.literal(`LOWER(TRIM("DealerLeadAssignment"."dealerId")) IN (${sentinels})`),
        Sequelize.literal(`
          EXISTS (
            SELECT 1 FROM "calling_leads" AS cl
            WHERE cl."id" = "DealerLeadAssignment"."leadId"
              AND cl."batchId" = '${batchId.replace(/'/g, "''")}'
          )
        `)
      ]
    },
    order: [
      [Sequelize.literal('COALESCE("DealerLeadAssignment"."assignedAt", "DealerLeadAssignment"."createdAt")'), 'ASC'],
      ['id', 'ASC']
    ],
    transaction,
    lock: transaction.LOCK.UPDATE
  });

  // Leads in batch with no assignment row at all
  const leadsWithoutAssignment = await CallingLead.findAll({
    where: {
      batchId,
      [Op.and]: [
        Sequelize.literal(`
          NOT EXISTS (
            SELECT 1 FROM "dealer_lead_assignments" AS da
            WHERE da."leadId" = "CallingLead"."id"
          )
        `)
      ]
    },
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
    transaction,
    lock: transaction.LOCK.UPDATE
  });

  let cursor = 0;
  let moved = 0;
  const now = new Date();

  for (const assignment of poolAssignments) {
    const dealerId = dealerIds[cursor % dealerIds.length];
    cursor += 1;
    await assignment.update(
      {
        dealerId,
        status: 'assigned',
        assignedAt: now,
        action: null,
        callRemark: null,
        nextFollowUpAt: null,
        actionAt: null
      },
      { transaction }
    );
    moved += 1;
  }

  for (const lead of leadsWithoutAssignment) {
    const dealerId = dealerIds[cursor % dealerIds.length];
    cursor += 1;
    await DealerLeadAssignment.create(
      {
        id: uuidv4(),
        leadId: lead.id,
        dealerId,
        assignedBy: assignedByUserId,
        assignedAt: now,
        status: 'assigned'
      },
      { transaction }
    );
    moved += 1;
  }

  // Duplicate CSV rows: adopt existing leads (same mobile) into this batch and assign if not
  // already actively held by a dealer (pool / completed / rescheduled / missing assignment).
  moved += await adoptAndAssignDuplicateUploadLeadsForBatch({
    batchId,
    dealerIds,
    assignedByUserId,
    transaction,
    dealerCursorStart: cursor
  });

  return moved;
};

/**
 * §15 — Duplicate CSV mobiles were previously skipped. Adopt those existing leads into
 * this upload batch and round-robin assign them to dealers when they are pool/unassigned,
 * completed, rescheduled, or have no assignment (do not steal in_progress/assigned).
 */
const adoptAndAssignDuplicateUploadLeadsForBatch = async ({
  batchId,
  dealerIds,
  assignedByUserId,
  transaction,
  dealerCursorStart = 0,
  mobiles
}: {
  batchId: string;
  dealerIds: string[];
  assignedByUserId: string;
  transaction: any;
  dealerCursorStart?: number;
  /** Optional explicit mobiles (upload path). Otherwise reads duplicate audit rows. */
  mobiles?: string[];
}): Promise<number> => {
  if (!dealerIds.length) return 0;

  let mobileList = (mobiles || [])
    .map((m) => normalizeMobile(m) || String(m || '').replace(/\D/g, '').slice(-10))
    .filter((m) => Boolean(m) && m.length >= 8);

  if (!mobileList.length) {
    const dupRows = await CallingLeadUploadRow.findAll({
      where: { batchId, status: 'duplicate' },
      attributes: ['customerMobile', 'id', 'leadId'],
      transaction
    });
    mobileList = Array.from(
      new Set(
        dupRows
          .map((row) => normalizeMobile(row.customerMobile))
          .filter((m): m is string => Boolean(m))
      )
    );
  }

  if (!mobileList.length) return 0;

  const existingLeads = await CallingLead.findAll({
    where: { mobileNormalized: { [Op.in]: mobileList } },
    transaction,
    lock: transaction.LOCK.UPDATE
  });
  if (!existingLeads.length) return 0;

  const leadByMobile = new Map(existingLeads.map((lead) => [String(lead.mobileNormalized), lead]));
  let cursor = Math.max(0, dealerCursorStart);
  let moved = 0;
  const now = new Date();
  const adoptedLeadIds: string[] = [];

  for (const mobile of mobileList) {
    const lead = leadByMobile.get(mobile);
    if (!lead) continue;

    const latest = await DealerLeadAssignment.findOne({
      where: {
        [Op.and]: [{ leadId: lead.id }, LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE]
      },
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    const latestStatus = String(latest?.status || '').toLowerCase();
    const latestDealerId = String(latest?.dealerId || '');
    const isPool = isPoolOrUnassignedAssigneeId(latestDealerId);
    const isActiveHold =
      !isPool &&
      ['assigned', 'active', 'in_progress'].includes(latestStatus) &&
      isValidHrCallingAssigneeDealerId(latestDealerId);

    // Already with a dealer as open work — leave alone.
    if (isActiveHold) continue;

    // Adopt into this upload so HR badges / View include the row.
    if (String(lead.batchId || '') !== batchId) {
      await lead.update({ batchId }, { transaction });
    }

    const dealerId = dealerIds[cursor % dealerIds.length];
    cursor += 1;

    if (latest && (isPool || latestStatus === 'queued')) {
      await latest.update(
        {
          dealerId,
          status: 'assigned',
          assignedAt: now,
          assignedBy: assignedByUserId,
          action: null,
          callRemark: null,
          nextFollowUpAt: null,
          actionAt: null
        },
        { transaction }
      );
    } else {
      // completed / rescheduled / missing / other — create a NEW assignment so history stays intact
      await DealerLeadAssignment.create(
        {
          id: uuidv4(),
          leadId: lead.id,
          dealerId,
          assignedBy: assignedByUserId,
          assignedAt: now,
          status: 'assigned'
        },
        { transaction }
      );
    }

    adoptedLeadIds.push(lead.id);
    moved += 1;
  }

  if (adoptedLeadIds.length) {
    // Link duplicate audit rows to the adopted lead ids for View/search.
    const dupRows = await CallingLeadUploadRow.findAll({
      where: {
        batchId,
        status: 'duplicate',
        customerMobile: { [Op.ne]: null }
      },
      transaction
    });
    for (const row of dupRows) {
      const mobile = normalizeMobile(row.customerMobile);
      if (!mobile) continue;
      const lead = leadByMobile.get(mobile);
      if (!lead || !adoptedLeadIds.includes(lead.id)) continue;
      await row.update({ leadId: lead.id }, { transaction });
    }
  }

  return moved;
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

const truncateVarchar = (value: string | null | undefined, maxLen: number): string | null => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
};

const resolveNextFollowUpAtFromRequest = (body: Record<string, unknown>): string | undefined => {
  const value = String(body.nextFollowUpAt ?? body.next_follow_up_at ?? '').trim();
  return value || undefined;
};

const normalizeStatusCategory = (rawCategory: unknown): (typeof ALLOWED_STATUS_CATEGORIES)[number] | null => {
  const clean = String(rawCategory || '').trim();
  if (!clean) return null;
  if ((ALLOWED_STATUS_CATEGORIES as readonly string[]).includes(clean)) {
    return clean as (typeof ALLOWED_STATUS_CATEGORIES)[number];
  }
  const mapped = STATUS_CATEGORY_ALIASES[clean];
  return mapped && (ALLOWED_STATUS_CATEGORIES as readonly string[]).includes(mapped)
    ? mapped
    : null;
};

/** Replace tagged remark — never append nested `[category]` chains (§E.2). */
const buildTaggedCallRemark = (
  category: string | null,
  label: string | null,
  freeText: string | null
): string | null => {
  if (!category || !label) return freeText?.trim() || null;
  const remark = String(freeText || '').trim();
  return remark ? `[${category}] ${label} | ${remark}` : `[${category}] ${label}`;
};

const sanitizeTaggedCallRemarkForPersist = (rawRemark: string | null): string | null => {
  if (!rawRemark) return null;
  const parsed = parseTaggedCallRemark(rawRemark);
  const category =
    normalizeStatusCategory(parsed.statusCategory) ||
    (parsed.statusCategory?.trim() || null);
  const label = String(parsed.status || '')
    .replace(/^\[[^\]]+\]\s*/g, '')
    .trim();
  if (!category || !label) return rawRemark.trim();
  return buildTaggedCallRemark(category, label, parsed.remark);
};

/** Echo camelCase + snake_case remark/status fields on queue rows (§E). */
const withCallingRemarkApiAliases = <T extends Record<string, unknown>>(row: T): T & {
  call_remark: unknown;
  status_category: unknown;
  status_text: unknown;
  statusText: unknown;
  action_at: unknown;
  next_follow_up_at: unknown;
} => {
  const statusText = row.statusText ?? row.statusLabel ?? null;
  const actionAt = row.actionAt ?? null;
  const nextFollowUpAt = row.nextFollowUpAt ?? null;
  return {
    ...row,
    call_remark: row.call_remark ?? row.callRemark ?? null,
    status_category: row.status_category ?? row.statusCategory ?? row.statusCategoryKey ?? null,
    status_text: row.status_text ?? statusText,
    statusText,
    action_at: row.action_at ?? actionAt,
    next_follow_up_at: row.next_follow_up_at ?? nextFollowUpAt
  };
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
    statusText: row.statusLabel || parsed.status || null,
    status_text: row.statusLabel || parsed.status || null,
    call_remark: row.callRemark ?? row.call_remark ?? null,
    // explicit fields required by frontend
    statusCategory: normalizedCategory,
    status_category: normalizedCategory,
    status: row.statusLabel || parsed.status || row.action || row.status || null,
    remark: row.statusReason || parsed.remark || null,
    // Required by Calling Data > Recent Actions card
    kNumber: row.kNumber ?? row.k_number ?? row.lead?.kNumber ?? row.lead?.k_number ?? null,
    address: row.address ?? row.leadAddress ?? row.lead_address ?? row.lead?.address ?? null,
    nextFollowUpAt: toIsoStringOrNull(row.nextFollowUpAt),
    assignmentStatus: row.status,
    customerNote: row.lead?.customerNote ?? row.customerNote ?? null,
    customer_note: row.lead?.customerNote ?? row.customerNote ?? null,
    city: row.lead?.city ?? row.city ?? null,
    state: row.lead?.state ?? row.state ?? null
  };
};

/** Rows that belong on the Scheduled tab — not Dialled / Connected / Not Connected. */
const isScheduledActionRow = (row: { action?: unknown; nextFollowUpAt?: string | Date | null }): boolean => {
  if (!row.nextFollowUpAt) return false;
  const actionName = String(row.action || '');
  if (actionName === 'rescheduled') return true;
  if (actionName === 'follow_up') {
    const at = new Date(row.nextFollowUpAt).getTime();
    return Number.isFinite(at);
  }
  return false;
};

const filterDialledActions = (recentActions: any[]) =>
  recentActions.filter((row: any) => {
    const actionName = String(row.action || '');
    if (!['called', 'follow_up', 'not_interested', 'rescheduled'].includes(actionName)) {
      return false;
    }
    if (isScheduledActionRow(row)) return false;
    return true;
  });

const buildQueueCountsPayload = (counts: Awaited<ReturnType<typeof buildDealerQueueCounts>>) => ({
  pendingCount: counts.pendingCount,
  queuedCount: counts.queuedCount,
  scheduledCount: counts.scheduledCount,
  completedCount: counts.completedCount,
  counts: {
    pending: counts.pendingCount,
    queued: counts.queuedCount,
    scheduled: counts.scheduledCount,
    completed: counts.completedCount
  }
});

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

/**
 * HR/Admin calling-actions GET (§J): supports ISO timestamps from the SPA and plain YYYY-MM-DD.
 * Plain dates use local start/end-of-day; full ISO strings are used as parsed (inclusive window on action_at).
 */
const parseReportDateQueryParam = (value: unknown, boundary: 'start' | 'end'): Date | null => {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    const parsed = new Date(y, m - 1, d);
    if (Number.isNaN(parsed.getTime())) return null;
    if (boundary === 'start') parsed.setHours(0, 0, 0, 0);
    else parsed.setHours(23, 59, 59, 999);
    return parsed;
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** Monday 00:00:00.000 — Sunday 23:59:59.999 in the server's local timezone (§J weekly alignment). */
const getMondayThroughSundayWeekBounds = (reference: Date): { from: Date; to: Date } => {
  const from = new Date(reference);
  const dow = from.getDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  from.setDate(from.getDate() + diffToMonday);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 6);
  to.setHours(23, 59, 59, 999);
  return { from, to };
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

const getReasonCategoryFromAction = (
  action: CallingActionType,
  outcome?: {
    statusLabel?: string | null;
    statusReason?: string | null;
    callRemark?: string | null;
    statusCategory?: string | null;
  }
): ReasonCategory => {
  if (outcome) {
    return inferReasonCategoryFromOutcome({
      action,
      statusLabel: outcome.statusLabel,
      statusReason: outcome.statusReason,
      callRemark: outcome.callRemark,
      statusCategory: outcome.statusCategory
    });
  }
  if (action === 'not_interested') return 'not_interested';
  if (action === 'follow_up' || action === 'rescheduled') return 'follow_up';
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

  if (range === 'custom' && (startDate || endDate)) {
    return { rangeStart, rangeEnd };
  }

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
      const week = getMondayThroughSundayWeekBounds(now);
      rangeStart = week.from;
      rangeEnd = week.to;
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
    custom: 'custom',
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
  const startDate = parseReportDateQueryParam(req.query.startDate ?? req.query.start_date, 'start');
  const endDate = parseReportDateQueryParam(req.query.endDate ?? req.query.end_date, 'end');

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
  const limit = Math.min(parsePositiveInt(req.query.limit, 20), 2000);
  const offset = (page - 1) * limit;
  const hasExplicitLimit = req.query.limit !== undefined && req.query.limit !== null;
  const summaryScope = String(req.query.summaryScope || req.query.summary_scope || 'page').trim().toLowerCase();
  const wantsFullSummary = !hasExplicitLimit && summaryScope === 'full';
  const where = buildCallingActionsFilter(req);

  const rows = await CallingActionHistory.findAndCountAll({
    where,
    raw: true,
    order: [['actionAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset
  });

  const summarySourceRows = wantsFullSummary
    ? await CallingActionHistory.findAll({
        where,
        raw: true,
        attributes: [
          'action',
          'statusLabel',
          'statusReason',
          'callRemark',
          'statusCategory',
          'reasonCategory'
        ]
      })
    : rows.rows;

  const actionDealerIds = Array.from(new Set(rows.rows.map((row: any) => String(row.dealerId || '')).filter(Boolean)));
  const now = Date.now();
  const activeDealersPromise =
    cachedActiveDealers && cachedActiveDealersExpiresAt > now
      ? Promise.resolve(cachedActiveDealers)
      : Dealer.findAll({
          where: { role: 'dealer', isActive: true },
          raw: true,
          attributes: ['id', 'firstName', 'lastName'],
          order: [['firstName', 'ASC'], ['lastName', 'ASC']]
        }).then((dealers) => {
          cachedActiveDealers = (dealers as any[]).map((d) => ({
            id: String(d.id),
            firstName: String(d.firstName || ''),
            lastName: String(d.lastName || '')
          }));
          cachedActiveDealersExpiresAt = Date.now() + CALLING_DEALERS_CACHE_TTL_MS;
          return cachedActiveDealers;
        });

  const missingDealerIds = actionDealerIds.filter((dealerId) => {
    const row = rows.rows.find((r: any) => String(r.dealerId || '') === dealerId);
    return !String((row as any)?.dealerName || '').trim();
  });

  const [allDealers, actionDealers] = await Promise.all([
    activeDealersPromise,
    missingDealerIds.length
      ? Dealer.findAll({
          where: { id: { [Op.in]: missingDealerIds } },
          raw: true,
          attributes: ['id', 'firstName', 'lastName']
        })
      : Promise.resolve([])
  ]);
  const dealerNameMap = new Map<string, string>();
  for (const dealer of actionDealers as any[]) {
    dealerNameMap.set(String(dealer.id), `${dealer.firstName || ''} ${dealer.lastName || ''}`.trim());
  }

  const total = rows.count;
  const summarySeed = {
    interested: 0,
    follow_up: 0,
    not_interested: 0,
    others: 0,
    total: summarySourceRows.length
  };
  const summary = (summarySourceRows as any[]).reduce((acc, row) => {
    const bucket = classifyCallingActionSummaryBucket({
      action: row.action,
      statusLabel: row.statusLabel,
      statusReason: row.statusReason,
      callRemark: row.callRemark,
      statusCategory: row.statusCategory
    });
    if (bucket === 'interested') acc.interested += 1;
    else if (bucket === 'followUp') acc.follow_up += 1;
    else if (bucket === 'notInterested') acc.not_interested += 1;
    else acc.others += 1;
    return acc;
  }, summarySeed);

  const actionRows = rows.rows.map((row: any) => {
    const statusText = resolveCallingActionStatusText({
      statusLabel: row.statusLabel,
      statusReason: row.statusReason,
      callRemark: row.callRemark
    });
    const reasonCategory =
      row.reasonCategory ||
      inferReasonCategoryFromOutcome({
        action: row.action,
        statusLabel: row.statusLabel,
        statusReason: row.statusReason,
        callRemark: row.callRemark,
        statusCategory: row.statusCategory
      });
    return {
      id: row.id,
      leadId: row.leadId,
      dealerId: row.dealerId,
      dealerName: row.dealerName || dealerNameMap.get(row.dealerId) || '',
      action: row.action,
      reasonCategory,
      callRemark: row.callRemark,
      call_remark: row.callRemark,
      statusCategory: row.statusCategory,
      status_category: row.statusCategory,
      statusText,
      status_text: statusText,
      statusLabel: row.statusLabel,
      statusReason: row.statusReason,
      remark: row.statusReason,
      isCustomReason: row.isCustomReason,
      statusCategoryKey: row.statusCategory,
      statusCategoryLabel: row.statusLabel,
      actionAt: toIsoStringOrNull(row.actionAt),
      action_at: toIsoStringOrNull(row.actionAt),
      nextFollowUpAt: toIsoStringOrNull(row.nextFollowUpAt),
      customerName: row.customerName,
      customerMobile: row.customerMobile,
      customerAddress: row.customerAddress,
      createdAt: toIsoStringOrNull(row.createdAt)
    };
  });

  const dealers = (allDealers as any[]).map((dealer) => ({
    dealerId: String(dealer.id),
    dealerName: `${dealer.firstName || ''} ${dealer.lastName || ''}`.trim()
  }));

  return {
    // Primary list key
    actions: actionRows,
    // Compatibility aliases for different frontend integrations
    callingActions: actionRows,
    list: actionRows,
    rows: actionRows,
    items: actionRows,
    logs: actionRows,
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

const CALLING_SUMMARY_CACHE_TTL_MS = 20 * 1000;
const callingSummaryCache = new Map<string, { expiresAt: number; summary: any }>();

const buildCallingActionsSummaryOnly = async (req: Request) => {
  const where = buildCallingActionsFilter(req);
  const dealerId = String(req.query.dealerId || req.query.dealer_id || '');
  const startDate = String(req.query.startDate || req.query.start_date || '');
  const endDate = String(req.query.endDate || req.query.end_date || '');
  const range = String(req.query.range || req.query.dateRange || '');
  const cacheKey = `sum:${dealerId}:${startDate}:${endDate}:${range}`;
  const cached = callingSummaryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.summary;
  }

  const summarySourceRows = await CallingActionHistory.findAll({
    where,
    raw: true,
    attributes: [
      'action',
      'statusLabel',
      'statusReason',
      'callRemark',
      'statusCategory',
      'reasonCategory'
    ]
  });

  const summarySeed = {
    interested: 0,
    follow_up: 0,
    not_interested: 0,
    others: 0,
    total: summarySourceRows.length
  };
  const summary = (summarySourceRows as any[]).reduce((acc, row) => {
    const bucket = classifyCallingActionSummaryBucket({
      action: row.action,
      statusLabel: row.statusLabel,
      statusReason: row.statusReason,
      callRemark: row.callRemark,
      statusCategory: row.statusCategory
    });
    if (bucket === 'interested') acc.interested += 1;
    else if (bucket === 'followUp') acc.follow_up += 1;
    else if (bucket === 'notInterested') acc.not_interested += 1;
    else acc.others += 1;
    return acc;
  }, summarySeed);

  const payload = {
    interested: summary.interested,
    followUp: summary.follow_up,
    notInterested: summary.not_interested,
    others: summary.others,
    total: summary.total
  };
  callingSummaryCache.set(cacheKey, {
    expiresAt: Date.now() + CALLING_SUMMARY_CACHE_TTL_MS,
    summary: payload
  });
  return payload;
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
  try {
    const limit = normalizeActiveLimitPerDealer(activeLimitPerDealer);

    // §15 — free stuck work back into the pool before allocating.
    await reclaimStuckCallingAssignments(transaction);

    // §4.5.1 / §E.1 — one open call per dealer: do not promote while in_progress is open.
    const openCallCount = await DealerLeadAssignment.count({
      where: {
        [Op.and]: [
          { dealerId, status: 'in_progress' },
          LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE,
          dealerBatchEligibilityClause(dealerId)
        ]
      },
      transaction
    });
    if (openCallCount > 0) return;

    // Cap: do not hand out another lead while dealer already holds assigned/active slots.
    const openSlots = await countDealerOpenCallingSlots(dealerId, transaction);
    if (openSlots >= limit) return;

    // 1) Dealer's own queued row (oldest first)
    const queued = await DealerLeadAssignment.findOne({
      where: {
        [Op.and]: [
          { dealerId, status: 'queued' },
          LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE,
          dealerBatchEligibilityClause(dealerId)
        ]
      },
      order: [['assignedAt', 'ASC'], ['createdAt', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (queued) {
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
      return;
    }

    // 2) Pool / sentinel assignee (unassigned, pool, open, …) — FCFS claim with SKIP LOCKED via raw SQL
    const [poolRows] = await sequelize.query(
      `
      SELECT dla."id"
      FROM "dealer_lead_assignments" AS dla
      WHERE dla."status" IN ('queued', 'assigned', 'active')
        AND LOWER(TRIM(dla."dealerId")) IN (${Array.from(HR_UPLOAD_UNASSIGNED_DEALER_SENTINELS)
          .map((value) => `'${value.replace(/'/g, "''")}'`)
          .join(', ')})
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
        AND EXISTS (
          SELECT 1
          FROM "calling_leads" AS cl
          WHERE cl."id" = dla."leadId"
            AND (
              cl."batchId" IS NULL
              OR EXISTS (
                SELECT 1
                FROM "calling_lead_upload_batches" AS b
                WHERE b."id" = cl."batchId"
                  AND ${batchDealerEligibilityPredicate(dealerId, 'b')}
              )
            )
        )
      ORDER BY COALESCE(dla."assignedAt", dla."createdAt") ASC, dla."id" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
      `,
      { transaction }
    );

    const poolId = Array.isArray(poolRows) && poolRows[0] ? String((poolRows[0] as any).id || '') : '';
    if (poolId) {
      await DealerLeadAssignment.update(
        {
          dealerId,
          status: 'assigned',
          assignedAt: new Date(),
          action: null,
          callRemark: null,
          nextFollowUpAt: null,
          actionAt: null
        },
        { where: { id: poolId }, transaction }
      );
      return;
    }

    // 3) Leads with no assignment row yet — create assignment (legacy / edge)
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
      let assignedBy: string | null = null;
      try {
        assignedBy = await resolveSystemAssignedByUserId(transaction);
      } catch (error) {
        logError('resolveSystemAssignedByUserId failed during promote (non-fatal)', error, { dealerId });
        return;
      }
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
    }

    // Do NOT steal assigned leads from other dealers — that fights FCFS (§15).
  } catch (error) {
    logError('promoteQueuedLeadIfSlotAvailable failed (non-fatal)', error, { dealerId });
  }
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
    if (isPoolOrUnassignedAssigneeId(latest.dealerId)) {
      const eligible = await isLeadEligibleForDealerPool(leadId, dealerId, transaction);
      if (!eligible) {
        const error: any = new Error('LEAD_NOT_ASSIGNED');
        error.code = 'LEAD_004';
        throw error;
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
  const parsedRemark = parseTaggedCallRemark(assignment.callRemark);
  const statusCategory = normalizeStatusCategory(parsedRemark.statusCategory);
  const statusText = parsedRemark.status;

  return withCallingRemarkApiAliases({
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
    assignmentStatus: assignment.status,
    callRemark: assignment.callRemark,
    statusCategory,
    statusLabel: statusText,
    nextFollowUpAt: toIsoStringOrNull(assignment.nextFollowUpAt),
    actionAt: toIsoStringOrNull(assignment.actionAt),
    customer_note: lead?.customerNote || null
  });
};

const patchDealerCallingLeadCustomerNote = async (req: Request, res: Response): Promise<void> => {
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
    const noteRaw = body.customerNote ?? body.customer_note;
    const customerNote =
      noteRaw === null || noteRaw === undefined ? null : String(noteRaw).trim() || null;

    let leadPayload: any = null;

    await sequelize.transaction(async (transaction) => {
      await resolveAssignmentForDealerAction(leadId, dealerId, transaction, true);
      const lead = await CallingLead.findByPk(leadId, {
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!lead) {
        const error: any = new Error('LEAD_NOT_FOUND');
        error.code = 'RES_001';
        throw error;
      }
      await lead.update({ customerNote }, { transaction });
      const assignment = await DealerLeadAssignment.findOne({
        where: {
          [Op.and]: [{ leadId, dealerId }, LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE]
        },
        transaction
      });
      if (assignment) {
        leadPayload = await buildCallingLeadQueuePayload(assignment, transaction);
      } else {
        await lead.reload({ transaction });
        leadPayload = {
          id: lead.id,
          leadId: lead.id,
          name: lead.name,
          mobile: lead.mobile,
          customerNote: lead.customerNote,
          customer_note: lead.customerNote
        };
      }
    });

    applyNoCacheHeaders(res);
    res.json({
      success: true,
      data: {
        lead: leadPayload,
        currentLead: leadPayload
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
    logError('Patch dealer calling lead customer note error', error, {
      dealerId: req.dealer?.id,
      leadId: req.params.leadId
    });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
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
  const body = (req.body || {}) as Record<string, unknown>;
  const hasCustomerNote = body.customerNote !== undefined || body.customer_note !== undefined;
  const hasAssignIntent = Boolean(
    body.assignedDealerId ||
      body.assigned_dealer_id ||
      body.dealerId ||
      body.dealer_id ||
      body.status
  );
  if (hasCustomerNote && !hasAssignIntent) {
    await patchDealerCallingLeadCustomerNote(req, res);
    return;
  }
  await assignCallingLeadToDealerFromRequest(req, res, 'Patch dealer calling lead error');
};

export const uploadCallingLeadsCsv = async (req: Request, res: Response): Promise<void> => {
  /**
   * §15-C-2 — hardened POST /hr/leads/upload-csv
   * Never 500 on bad CSV / one bad row / assign FK / large file timeout.
   * SPA: file|csvFile, dealerIds[]|dealerIds, activeLimitPerDealer=1..50
   * assignmentMode=round_robin_all → ignore numeric cap server-side.
   */
  try {
    const filesByField = ((req as any).files || {}) as Record<string, Express.Multer.File[]>;
    const file =
      (filesByField.file && filesByField.file[0]) ||
      (filesByField.csvFile && filesByField.csvFile[0]) ||
      ((req as any).file as Express.Multer.File | undefined);
    if (!file?.buffer) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: 'CSV file required (file or csvFile)' }
      });
      return;
    }

    const dealerIds = parseDealerIds(req.body.dealerIds).length
      ? parseDealerIds(req.body.dealerIds)
      : parseDealerIds(req.body['dealerIds[]']);
    const assignmentModeRaw =
      req.body.assignmentMode ?? req.body.assignment_mode ?? req.body.mode ?? '';
    const roundRobinAll = isRoundRobinAllAssignmentMode(assignmentModeRaw);
    const activeLimitPerDealer = roundRobinAll
      ? Number.MAX_SAFE_INTEGER
      : normalizeActiveLimitPerDealer(
          req.body.activeLimitPerDealer ?? req.body.activeLeadsLimit ?? DEFAULT_ACTIVE_LIMIT_PER_DEALER
        );

    if (dealerIds.length === 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_002',
          message: 'At least one dealerId required'
        }
      });
      return;
    }

    // 1) Validate dealer ids exist before insert/assign → 400 VAL_002 if unknown
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
          code: 'VAL_002',
          message: 'Unknown or inactive dealerIds',
          details: invalidIds.map((id) => ({ field: 'dealerIds', message: `Invalid dealer id: ${id}` }))
        }
      });
      return;
    }

    // 2) Wrap CSV parse in try/catch → 400 VAL_001 on bad file
    let rows: Record<string, unknown>[] = [];
    try {
      const workbook = XLSX.read(file.buffer, { type: 'buffer', raw: false });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];
      if (!sheet) {
        res.status(400).json({
          success: false,
          error: { code: 'VAL_001', message: 'Invalid CSV format — no sheet found' }
        });
        return;
      }
      rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[];
    } catch (parseError) {
      logError('HR upload CSV parse failed', parseError, { userId: req.user?.id });
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: `Invalid CSV format: ${truncateErrorMessage(parseError, 160)}`
        }
      });
      return;
    }

    if (!rows.length) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: 'No valid rows found in CSV' }
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
        error: { code: 'VAL_001', message: 'No valid rows found in CSV' }
      });
      return;
    }

    // Chunk existing-mobile lookup (large IN lists can fail / timeout)
    const existingMobiles = new Set<string>();
    for (let i = 0; i < normalizedRows.length; i += UPLOAD_INSERT_CHUNK_SIZE) {
      const slice = normalizedRows.slice(i, i + UPLOAD_INSERT_CHUNK_SIZE);
      const existingLeads = await CallingLead.findAll({
        where: { mobileNormalized: { [Op.in]: slice.map((row) => row.mobile) } },
        attributes: ['mobileNormalized']
      });
      for (const lead of existingLeads as any[]) {
        existingMobiles.add(String(lead.mobileNormalized));
      }
    }

    const rowsToCreate = normalizedRows.filter((row) => !existingMobiles.has(row.mobile));
    const duplicateExistingRows = normalizedRows.filter((row) => existingMobiles.has(row.mobile));
    const skippedDuplicateInFile = duplicateInFile.size;

    let created = 0;
    let assigned = 0;
    let queued = 0;
    let duplicatesAssigned = 0;
    let skippedDuplicateRuntime = 0;

    await ensureCallingPoolDealerExists();

    // Create batch shell first (own short transaction)
    let assignedByUserId = '1';
    await sequelize.transaction(async (transaction) => {
      await CallingLeadUploadBatch.create(
        {
          id: batchId,
          fileName: file.originalname || 'upload.csv',
          uploadedBy: req.user?.id || 'unknown',
          uploadedAt: new Date(),
          rowCount: parsed,
          assignedDealers: dealerIds
        },
        { transaction }
      );
      assignedByUserId = await resolveAssignedByUserId(req, transaction);
    });

    const activeCountByDealer = new Map<string, number>();
    if (!roundRobinAll) {
      for (const dealerId of dealerIds) {
        const openCount = await DealerLeadAssignment.count({
          where: {
            [Op.and]: [
              {
                dealerId,
                status: { [Op.in]: ['assigned', 'active', 'in_progress'] }
              },
              LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE
            ]
          }
        });
        activeCountByDealer.set(dealerId, openCount);
      }
    }
    let dealerCursor = 0;

    const pickAssignee = (): { dealerId: string; status: 'assigned' | 'queued' } => {
      if (roundRobinAll) {
        const dealerId = dealerIds[dealerCursor % dealerIds.length];
        dealerCursor += 1;
        return { dealerId, status: 'assigned' };
      }
      for (let i = 0; i < dealerIds.length; i += 1) {
        const idx = (dealerCursor + i) % dealerIds.length;
        const candidateDealerId = dealerIds[idx];
        const currentActive = activeCountByDealer.get(candidateDealerId) || 0;
        if (currentActive < activeLimitPerDealer) {
          activeCountByDealer.set(candidateDealerId, currentActive + 1);
          dealerCursor = (idx + 1) % dealerIds.length;
          return { dealerId: candidateDealerId, status: 'assigned' };
        }
      }
      return { dealerId: POOL_UNASSIGNED_DEALER_ID, status: 'queued' };
    };

    // 4) Chunk inserts (500 rows) — large CSVs must not timeout → 500
    for (let offset = 0; offset < rowsToCreate.length; offset += UPLOAD_INSERT_CHUNK_SIZE) {
      const chunk = rowsToCreate.slice(offset, offset + UPLOAD_INSERT_CHUNK_SIZE);
      const chunkAudit: typeof rowAudit = [];

      await sequelize.transaction(async (transaction) => {
        for (const row of chunk) {
          const savepoint = `sp_r${row.rowIndex}`;
          // SAVEPOINT so one unique/FK failure does not abort the whole chunk transaction (PG).
          await sequelize.query(`SAVEPOINT "${savepoint}"`, { transaction });

          let lead: CallingLead | null = null;
          try {
            lead = await CallingLead.create(
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
          } catch (rowError) {
            await sequelize.query(`ROLLBACK TO SAVEPOINT "${savepoint}"`, { transaction });
            if (isUniqueConstraintError(rowError)) {
              skippedDuplicateRuntime += 1;
              chunkAudit.push({
                rowIndex: row.rowIndex,
                status: 'duplicate',
                customerName: row.name,
                customerMobile: row.mobile,
                customerAddress: buildCustomerAddress(row),
                rawPayload: row.rawPayload
              });
              continue;
            }
            logError('HR upload row insert failed (skipped)', rowError, {
              batchId,
              rowIndex: row.rowIndex,
              mobile: row.mobile
            });
            skippedDuplicateRuntime += 1;
            chunkAudit.push({
              rowIndex: row.rowIndex,
              status: 'invalid',
              customerName: row.name,
              customerMobile: row.mobile,
              customerAddress: buildCustomerAddress(row),
              rawPayload: row.rawPayload
            });
            continue;
          }

          // 5) Per-assign try/catch — skip failed dealer, try next (nested savepoints)
          let assignee = pickAssignee();
          let assignmentOk = false;
          const tried = new Set<string>();
          for (let attempt = 0; attempt < dealerIds.length + 1; attempt += 1) {
            if (tried.has(assignee.dealerId) && assignee.dealerId !== POOL_UNASSIGNED_DEALER_ID) {
              const nextIdx = dealerCursor % dealerIds.length;
              assignee = {
                dealerId: dealerIds[nextIdx],
                status: roundRobinAll ? 'assigned' : 'queued'
              };
              if (!roundRobinAll) {
                assignee = { dealerId: POOL_UNASSIGNED_DEALER_ID, status: 'queued' };
              }
              dealerCursor += 1;
            }
            tried.add(assignee.dealerId);

            const assignSp = `${savepoint}_a${attempt}`;
            await sequelize.query(`SAVEPOINT "${assignSp}"`, { transaction });
            try {
              await DealerLeadAssignment.create(
                {
                  id: uuidv4(),
                  leadId: lead!.id,
                  dealerId: assignee.dealerId,
                  assignedBy: assignedByUserId,
                  assignedAt: new Date(),
                  status: assignee.status as any
                },
                { transaction }
              );
              await sequelize.query(`RELEASE SAVEPOINT "${assignSp}"`, { transaction });
              assignmentOk = true;
              if (assignee.status === 'assigned') assigned += 1;
              else queued += 1;
              break;
            } catch (assignError) {
              await sequelize.query(`ROLLBACK TO SAVEPOINT "${assignSp}"`, { transaction });
              logError('HR upload assign failed (try next)', assignError, {
                batchId,
                leadId: lead!.id,
                dealerId: assignee.dealerId
              });
              if (assignee.dealerId !== POOL_UNASSIGNED_DEALER_ID) {
                assignee = { dealerId: POOL_UNASSIGNED_DEALER_ID, status: 'queued' };
                continue;
              }
              break;
            }
          }

          await sequelize.query(`RELEASE SAVEPOINT "${savepoint}"`, { transaction });

          if (!assignmentOk) {
            queued += 1;
          }

          chunkAudit.push({
            rowIndex: row.rowIndex,
            status: 'created',
            customerName: row.name,
            customerMobile: row.mobile,
            customerAddress: buildCustomerAddress(row),
            leadId: lead!.id,
            rawPayload: row.rawPayload
          });
        }

        if (chunkAudit.length > 0) {
          await CallingLeadUploadRow.bulkCreate(
            chunkAudit
              .filter((row) => row.rowIndex > 0)
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
    }

    // Persist invalid/in-file-duplicate audit rows (not already written with creates)
    const preCreateAudit = rowAudit.filter((row) => row.status === 'invalid' || row.status === 'duplicate');
    if (preCreateAudit.length > 0) {
      for (let i = 0; i < preCreateAudit.length; i += UPLOAD_INSERT_CHUNK_SIZE) {
        const slice = preCreateAudit.slice(i, i + UPLOAD_INSERT_CHUNK_SIZE);
        await CallingLeadUploadRow.bulkCreate(
          slice.map((row) => ({
            id: uuidv4(),
            batchId,
            rowIndex: row.rowIndex,
            customerName: row.customerName,
            customerMobile: row.customerMobile,
            customerAddress: row.customerAddress,
            status: row.status,
            leadId: row.leadId || null,
            rawPayload: row.rawPayload
          }))
        );
      }
    }

    // Existing mobiles: adopt into this batch + assign (best-effort, non-fatal)
    if (duplicateExistingRows.length) {
      try {
        await sequelize.transaction(async (transaction) => {
          await CallingLeadUploadRow.bulkCreate(
            duplicateExistingRows.map((row) => ({
              id: uuidv4(),
              batchId,
              rowIndex: row.rowIndex,
              customerName: row.name,
              customerMobile: row.mobile,
              customerAddress: buildCustomerAddress(row),
              status: 'duplicate' as UploadRowStatus,
              leadId: null,
              rawPayload: row.rawPayload
            })),
            { transaction }
          );

          duplicatesAssigned = await adoptAndAssignDuplicateUploadLeadsForBatch({
            batchId,
            dealerIds,
            assignedByUserId,
            transaction,
            dealerCursorStart: dealerCursor,
            mobiles: duplicateExistingRows.map((row) => row.mobile)
          });
          assigned += duplicatesAssigned;
        });
      } catch (dupError) {
        logError('HR upload duplicate adopt failed (non-fatal)', dupError, { batchId });
      }
    }

    await CallingLeadUploadBatch.update({ rowCount: parsed }, { where: { id: batchId } });

    const skippedDuplicate =
      skippedDuplicateInFile +
      skippedDuplicateRuntime +
      Math.max(0, duplicateExistingRows.length - duplicatesAssigned);

    logInfo('Calling leads CSV uploaded', {
      uploadedBy: req.user?.id,
      parsed,
      created,
      skippedDuplicate,
      duplicatesAssigned,
      assigned,
      queued,
      activeLimitPerDealer: roundRobinAll ? 'round_robin_all' : activeLimitPerDealer,
      assignmentMode: roundRobinAll ? 'round_robin_all' : 'active_cap'
    });

    res.status(201).json({
      success: true,
      parsed,
      created,
      assigned,
      queued,
      skippedDuplicate,
      uploadId: batchId,
      data: {
        parsed,
        batchId,
        uploadId: batchId,
        fileName: file.originalname || 'upload.csv',
        uploadedBy: req.user?.id || 'unknown',
        created,
        skippedDuplicate,
        duplicatesAssigned,
        assigned,
        queued,
        assignedAtUpload: assigned,
        queuedAtUpload: queued,
        activeLimitPerDealer: roundRobinAll ? null : activeLimitPerDealer,
        assignmentMode: roundRobinAll ? 'round_robin_all' : 'active_cap',
        rowCount: parsed,
        uploadedRowCount: parsed,
        leadCount: created + duplicatesAssigned,
        createdCount: created,
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
    // 6) Outer catch: SYS_001 with real e.message (truncated)
    const message = truncateErrorMessage(error);
    logError('Upload calling leads CSV error', error, { userId: req.user?.id, message });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message }
    });
  }
};

const CALLABLE_QUEUE_STATUSES = ['queued', 'assigned', 'active', 'in_progress'] as const;

/**
 * §15 — Harshita empty Current Lead fix:
 * If a lead is already assigned to THIS dealer, return it regardless of batch pool JSON.
 * (Eligibility only gates claiming from the unassigned pool.)
 */
const findOpenAssignedLeadsForDealer = async (dealerId: string, limit = 500) => {
  const now = new Date();
  return DealerLeadAssignment.findAll({
    where: {
      [Op.and]: [
        {
          dealerId,
          [Op.or]: [
            { status: { [Op.in]: [...CALLABLE_QUEUE_STATUSES] } },
            { status: 'rescheduled', nextFollowUpAt: { [Op.lte]: now } }
          ]
        },
        LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE
      ]
    },
    include: [{ model: CallingLead, as: 'lead', required: false }],
    order: [
      // Prefer in_progress first, then oldest assigned
      [
        Sequelize.literal(`
          CASE "DealerLeadAssignment"."status"
            WHEN 'in_progress' THEN 0
            WHEN 'assigned' THEN 1
            WHEN 'active' THEN 2
            WHEN 'queued' THEN 3
            ELSE 4
          END
        `),
        'ASC'
      ],
      [Sequelize.literal('COALESCE("DealerLeadAssignment"."assignedAt", "DealerLeadAssignment"."createdAt")'), 'ASC'],
      ['id', 'ASC']
    ],
    limit
  });
};

const mapAssignmentRowsToQueueLeads = async (dealerId: string, rows: any[]) => {
  const leadIds = rows.map((row: any) => String(row.leadId)).filter(Boolean);
  let latestStatusMap = new Map<string, LeadStatusMeta>();
  try {
    latestStatusMap = await buildLatestStatusMetaMap(dealerId, leadIds);
  } catch (error) {
    logError('buildLatestStatusMetaMap failed (non-fatal)', error, { dealerId });
  }

  const assigneeDealerIds = Array.from(
    new Set(rows.map((row: any) => String(row.dealerId)).filter((id) => isValidHrCallingAssigneeDealerId(id)))
  );
  let assigneeNameById = new Map<string, string>();
  try {
    const assigneeDealers = assigneeDealerIds.length
      ? await Dealer.findAll({
          where: { id: { [Op.in]: assigneeDealerIds } },
          attributes: ['id', 'firstName', 'lastName']
        })
      : [];
    assigneeNameById = new Map(
      assigneeDealers.map((dealer) => [
        dealer.id,
        `${dealer.firstName || ''} ${dealer.lastName || ''}`.trim()
      ])
    );
  } catch (error) {
    logError('assignee dealer name lookup failed (non-fatal)', error, { dealerId });
  }

  return rows
    .map((row: any) => {
      const lead = row.lead;
      if (!lead) return null;
      const latestStatus = latestStatusMap.get(String(row.leadId));
      const assignedDealerName = assigneeNameById.get(String(row.dealerId)) || null;
      return withCallingRemarkApiAliases({
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
        uploadBatchId: lead.batchId || null,
        queuedAt: toIsoStringOrNull(row.assignedAt || row.createdAt),
        dealerId: null,
        assignedDealerId: row.dealerId,
        assigned_dealer_id: row.dealerId,
        assignedDealerName,
        assigned_dealer_name: assignedDealerName,
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
      });
    })
    .filter(Boolean) as any[];
};

const buildCallableQueue = async (dealerId: string, limit = 500, allocate = true) => {
  // 1) Always surface leads already assigned to this dealer (no batch-pool eligibility filter).
  let rows = await findOpenAssignedLeadsForDealer(dealerId, limit);

  // 2) If free, claim oldest unassigned from eligible pools (FCFS).
  if (allocate && !rows.length) {
    try {
      await sequelize.transaction(async (transaction) => {
        await promoteQueuedLeadIfSlotAvailable(dealerId, DEFAULT_ACTIVE_LIMIT_PER_DEALER, transaction);
      });
    } catch (error) {
      logError('buildCallableQueue promote failed (non-fatal)', error, { dealerId });
    }
    rows = await findOpenAssignedLeadsForDealer(dealerId, limit);
  }

  return mapAssignmentRowsToQueueLeads(dealerId, rows as any[]);
};

const buildDealerQueueCounts = async (dealerId: string) => {
  // Count THIS dealer's own assignments — do not require batch pool eligibility
  // (same Harshita fix as buildCallableQueue).
  const [pendingCount, queuedCount, scheduledCount, completedCount] = await Promise.all([
    DealerLeadAssignment.count({
      where: {
        [Op.and]: [
          {
            dealerId,
            status: { [Op.in]: ['active', 'assigned', 'in_progress'] }
          },
          LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE
        ]
      }
    }),
    DealerLeadAssignment.count({
      where: {
        [Op.and]: [{ dealerId, status: 'queued' }, LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE]
      }
    }),
    DealerLeadAssignment.count({
      where: {
        [Op.and]: [{ dealerId, status: 'rescheduled' }, LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE]
      }
    }),
    DealerLeadAssignment.count({
      where: {
        [Op.and]: [{ dealerId, status: 'completed' }, LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE]
      }
    })
  ]);

  return { pendingCount, queuedCount, scheduledCount, completedCount };
};

const mapAssignmentToScheduledLead = (
  row: any,
  latestStatusMap: Map<string, LeadStatusMeta>
) => {
  const parsed = parseTaggedCallRemark(row.callRemark);
  const meta = latestStatusMap.get(String(row.leadId));
  const statusCategory =
    meta?.statusCategory ||
    normalizeStatusCategory(parsed.statusCategory) ||
    null;
  const statusText = meta?.statusLabel || parsed.status || null;
  const remark = meta?.statusReason || parsed.remark || null;

  return withCallingRemarkApiAliases({
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
    actionAt: toIsoStringOrNull(row.actionAt),
    callRemark: row.callRemark,
    statusCategory,
    statusLabel: statusText,
    statusText,
    statusReason: remark,
    remark,
    isCustomReason: meta?.isCustomReason || false,
    statusCategoryKey: statusCategory,
    statusCategoryLabel: statusText,
    nextFollowUpAt: toIsoStringOrNull(row.nextFollowUpAt),
    status: 'rescheduled'
  });
};

const dedupeScheduledLeadsByLeadId = (rows: any[]) => {
  const byLeadId = new Map<string, any>();
  for (const row of rows) {
    const leadId = String(row.leadId || row.id || '');
    if (!leadId || byLeadId.has(leadId)) continue;
    byLeadId.set(leadId, row);
  }
  return Array.from(byLeadId.values());
};

const buildScheduledLeads = async (dealerId: string) => {
  const rows = await DealerLeadAssignment.findAll({
    where: {
      [Op.and]: [
        {
          dealerId,
          status: 'rescheduled',
          nextFollowUpAt: { [Op.ne]: null }
        },
        LATEST_ASSIGNMENT_OWNERSHIP_CLAUSE
      ]
    },
    include: [{ model: CallingLead, as: 'lead', required: false }],
    order: [['nextFollowUpAt', 'ASC'], ['assignedAt', 'ASC'], ['id', 'ASC']],
    limit: 200
  });
  const leadIds = rows.map((row: any) => String(row.leadId)).filter(Boolean);
  const latestStatusMap = await buildLatestStatusMetaMap(dealerId, leadIds);

  return dedupeScheduledLeadsByLeadId(
    rows.map((row: any) => mapAssignmentToScheduledLead(row, latestStatusMap))
  );
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
    const items = dedupeScheduledLeadsByLeadId(
      rows.rows.map((row: any) => mapAssignmentToScheduledLead(row, latestStatusMap))
    );

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

export const getDealerCallingActions = async (req: Request, res: Response): Promise<void> => {
  try {
    const dealerId = await resolveDealerIdForQueue(req);
    if (!dealerId) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_003', message: 'User not authenticated' }
      });
      return;
    }

    const scopedReq = Object.assign(req, {
      query: { ...req.query, dealerId }
    });
    if (
      req.query.dealerId &&
      String(req.query.dealerId).trim() !== dealerId
    ) {
      res.status(403).json({
        success: false,
        error: { code: 'AUTH_004', message: 'Cannot access another dealer calling actions' }
      });
      return;
    }
    const data = await buildCallingActionsResponse(scopedReq);
    applyNoCacheHeaders(res);
    res.json({ success: true, data });
  } catch (error) {
    logError('Get dealer calling actions error', error, { dealerId: req.dealer?.id });
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

    const items = filterDialledActions(rows.rows.map((row: any) => callingActionToApiJson(row)));
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
    const items = filterDialledActions(rows.rows.map((row: any) => callingActionToApiJson(row))).filter(
      (row: any) => classifyActionStage(row) === 'connected'
    );

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
    const items = filterDialledActions(rows.rows.map((row: any) => callingActionToApiJson(row))).filter(
      (row: any) => classifyActionStage(row) === 'not_connected'
    );

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

/** §4.5.1 / §E.1 — open in_progress row is currentLead; omit nextLead until Submit. */
const resolveDealerQueueHead = (queue: any[]) => {
  const inProgressRows = queue.filter((row) => row?.status === 'in_progress');
  if (inProgressRows.length) {
    const openCall = inProgressRows.sort((a, b) => {
      const aAt = a?.actionAt ? new Date(a.actionAt).getTime() : 0;
      const bAt = b?.actionAt ? new Date(b.actionAt).getTime() : 0;
      return aAt - bAt;
    })[0];
    return { lead: openCall, currentLead: openCall, nextLead: null };
  }

  const head = queue.length ? queue[0] : null;
  return { lead: head, currentLead: head, nextLead: head };
};

const buildDealerQueueSnapshot = async (
  dealerId: string,
  recentActionsLimit = 1000,
  options?: { allocate?: boolean }
) => {
  const allocate = options?.allocate !== false;
  const emptyCounts = { pendingCount: 0, queuedCount: 0, scheduledCount: 0, completedCount: 0 };

  let queue: any[] = [];
  let counts = emptyCounts;
  let scheduledLeads: any[] = [];
  let recentActions: any[] = [];

  try {
    queue = await buildCallableQueue(dealerId, 500, allocate);
  } catch (error) {
    logError('buildCallableQueue failed (non-fatal)', error, { dealerId });
    queue = [];
  }

  try {
    counts = await buildDealerQueueCounts(dealerId);
  } catch (error) {
    logError('buildDealerQueueCounts failed (non-fatal)', error, { dealerId });
  }

  try {
    scheduledLeads = await buildScheduledLeads(dealerId);
  } catch (error) {
    logError('buildScheduledLeads failed (non-fatal)', error, { dealerId });
  }

  try {
    recentActions = await buildRecentActions(dealerId, recentActionsLimit);
  } catch (error) {
    logError('buildRecentActions failed (non-fatal)', error, { dealerId });
  }

  const { lead, currentLead, nextLead } = resolveDealerQueueHead(queue);

  const dialledActions = filterDialledActions(recentActions);
  const connectedActions = dialledActions.filter((row: any) => classifyActionStage(row) === 'connected');
  const notConnectedActions = dialledActions.filter((row: any) => classifyActionStage(row) === 'not_connected');

  return {
    lead,
    currentLead,
    nextLead,
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
    upcomingFollowUps: [],
    rescheduledLeads: [],
    recentActions,
    dialledActions,
    connectedActions,
    notConnectedActions,
    // compatibility aliases expected by some frontend paths
    actionHistory: recentActions,
    completedActions: recentActions
  };
};

const emptyCallingQueueSnapshot = () => ({
  lead: null,
  currentLead: null,
  nextLead: null,
  queue: [],
  leads: [],
  pendingLeads: [],
  pendingCount: 0,
  queuedCount: 0,
  scheduledCount: 0,
  completedCount: 0,
  counts: { pending: 0, queued: 0, scheduled: 0, completed: 0 },
  scheduledLeads: [],
  upcomingFollowUps: [],
  rescheduledLeads: [],
  recentActions: [],
  dialledActions: [],
  connectedActions: [],
  notConnectedActions: [],
  actionHistory: [],
  completedActions: []
});

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
  /**
   * §15 P0 — always 200 with lead null|object. Prefer existing open call;
   * still soft-allocates so Current Lead is not blank when Unassigned > 0.
   * Never returns SYS_001 for empty/partial failures.
   *
   * Response shape: SPA reads both root `lead` and `data.lead`.
   */
  applyNoCacheHeaders(res);
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
    // Prefer already-assigned leads; allocate from pool only if dealer has none.
    const snapshot = await buildDealerQueueSnapshot(dealerId, recentActionsLimit, { allocate: true });
    let debugCounts = null;
    if (debug) {
      try {
        debugCounts = await buildDealerEligibilityDebugCounts(dealerId);
      } catch {
        debugCounts = null;
      }
    }

    const data = {
      ...snapshot,
      debugEligibility: debugCounts
    };
    res.status(200).json({
      success: true,
      ...data,
      data
    });
  } catch (error) {
    logError('Get dealer calling queue current error — returning empty 200', error, {
      dealerId: req.dealer?.id
    });
    const empty = emptyCallingQueueSnapshot();
    res.status(200).json({
      success: true,
      ...empty,
      data: empty
    });
  }
};

/** FCFS source of truth — return dealer's assigned lead, else claim oldest unassigned. */
export const getDealerCallingQueueNext = async (req: Request, res: Response): Promise<void> => {
  applyNoCacheHeaders(res);
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
    const snapshot = await buildDealerQueueSnapshot(dealerId, recentActionsLimit, { allocate: true });
    let debugCounts = null;
    if (debug) {
      try {
        debugCounts = await buildDealerEligibilityDebugCounts(dealerId);
      } catch {
        debugCounts = null;
      }
    }

    const data = {
      ...snapshot,
      debugEligibility: debugCounts
    };
    res.status(200).json({
      success: true,
      ...data,
      data
    });
  } catch (error) {
    logError('Get dealer calling queue next error — returning empty 200', error, {
      dealerId: req.dealer?.id
    });
    const empty = emptyCallingQueueSnapshot();
    res.status(200).json({
      success: true,
      ...empty,
      data: empty
    });
  }
};

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
    let {
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
      statusText?: string;
      remark?: string;
      call_remark?: string;
      claim?: boolean | string;
      autoAssign?: boolean | string;
      assignedDealerId?: string;
    };

    nextFollowUpAt = nextFollowUpAt || resolveNextFollowUpAtFromRequest(requestBody);
    if (action === 'follow_up' && nextFollowUpAt) {
      action = 'rescheduled';
    }

    const allowClaim = shouldAllowClaimOnAction(action, requestBody);

    const rawCallRemarkInput =
      String(callRemark ?? requestBody.call_remark ?? '').trim() || null;
    const parsed = parseTaggedCallRemark(rawCallRemarkInput);
    const hasParsedTags = Boolean(parsed.statusCategory || parsed.status);
    const freeRemark = String(requestBody.remark ?? '').trim() || null;

    const effectiveStatusCategory =
      normalizeStatusCategory(statusCategoryKey) ||
      normalizeStatusCategory(status_category) ||
      normalizeStatusCategory(statusCategory) ||
      normalizeStatusCategory(parsed.statusCategory) ||
      inferStatusCategoryFromRemark(rawCallRemarkInput) ||
      null;
    const effectiveStatusLabel =
      statusCategoryLabel ||
      statusLabel ||
      status_text ||
      String(requestBody.statusText ?? '').trim() ||
      parsed.status ||
      null;
    const effectiveStatusReason =
      (hasParsedTags ? parsed.remark : null) || statusReason || freeRemark || null;
    const legacyCallRemark =
      (effectiveStatusCategory && effectiveStatusLabel
        ? buildTaggedCallRemark(effectiveStatusCategory, effectiveStatusLabel, effectiveStatusReason)
        : null) || sanitizeTaggedCallRemarkForPersist(rawCallRemarkInput);

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
    if (requiresManualReason && !rawCallRemarkInput && !(effectiveStatusCategory && effectiveStatusLabel)) {
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

    const isOutcomeAction = action !== 'start';
    const isEditModeRequest = Boolean(editMode);
    if (isOutcomeAction && !isEditModeRequest) {
      const hasRemarkPayload = Boolean(
        rawCallRemarkInput || (effectiveStatusCategory && effectiveStatusLabel)
      );
      if (!hasRemarkPayload) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_001',
            message: 'Validation error',
            details: [{
              field: 'callRemark',
              message: 'callRemark or statusCategory + statusText is required for this action'
            }]
          }
        });
        return;
      }
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
      const effectiveCallRemarkForStart = legacyCallRemark ?? sanitizeTaggedCallRemarkForPersist(rawCallRemarkInput) ?? null;
      const effectiveCallRemarkForOutcome = legacyCallRemark;
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
          reasonCategory: getReasonCategoryFromAction(historyAction, {
            statusLabel: effectiveStatusLabel,
            statusReason: effectiveStatusReason,
            callRemark: effectiveCallRemarkForOutcome,
            statusCategory: effectiveStatusCategory
          }),
          callRemark: effectiveCallRemarkForOutcome,
          statusCategory: effectiveStatusCategory,
          statusLabel: truncateVarchar(effectiveStatusLabel, 128),
          statusReason: truncateVarchar(effectiveStatusReason, 255),
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
        updatedData = withCallingRemarkApiAliases({
          leadId: assignment.leadId,
          status: historyAction,
          assignmentStatus: assignment.status,
          action: assignment.action,
          callRemark: assignment.callRemark,
          nextFollowUpAt: toIsoStringOrNull(assignment.nextFollowUpAt),
          actionAt: toIsoStringOrNull(assignment.actionAt)
        });
        return;
      }

      const now = new Date();

      // --- start: idempotent when already in_progress; allow queued | assigned | active | due rescheduled ---
      if (action === 'start') {
        if (assignment.status === 'in_progress') {
          await assignment.reload({ transaction });
          updatedData = await buildCallingLeadQueuePayload(assignment, transaction);
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
          updatedData = await buildCallingLeadQueuePayload(assignment, transaction);
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
          updatedData = await buildCallingLeadQueuePayload(assignment, transaction);
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

      // §15 — after complete OR reschedule, free the slot and allocate next FIFO lead.
      if (assignment.status === 'completed' || assignment.status === 'rescheduled') {
        await promoteQueuedLeadIfSlotAvailable(dealerId, DEFAULT_ACTIVE_LIMIT_PER_DEALER, transaction);
      }

      updatedData = withCallingRemarkApiAliases({
        leadId: assignment.leadId,
        status: action,
        assignmentStatus: assignment.status,
        action: assignment.action,
        callRemark: assignment.callRemark,
        statusCategory: effectiveStatusCategory,
        statusLabel: effectiveStatusLabel,
        statusText: effectiveStatusLabel,
        remark: effectiveStatusReason,
        nextFollowUpAt: toIsoStringOrNull(assignment.nextFollowUpAt),
        actionAt: toIsoStringOrNull(assignment.actionAt)
      });
    });

    applyNoCacheHeaders(res);

    if (action === 'start') {
      const counts = await buildDealerQueueCounts(dealerId);
      res.json({
        success: true,
        data: {
          lead: updatedData,
          currentLead: updatedData,
          ...buildQueueCountsPayload(counts)
        }
      });
    } else {
      const snapshot = await buildDealerQueueSnapshot(dealerId, 1000);
      res.json({
        success: true,
        data: {
          ...updatedData,
          ...snapshot
        }
      });
    }

    if (action !== 'start') {
      emitRealtime(realtimeEvents.callingActionsUpdated, {
        dealerId,
        leadId,
        action,
        actionAt: (updatedData?.actionAt || new Date()).toISOString?.() || new Date().toISOString()
      });
    }
  } catch (error) {
    const err = error as any;
    const errorCode = err?.code;
    const errorMessage = String(err?.message || err?.parent?.message || '');
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
    if (
      err?.name === 'SequelizeDatabaseError' &&
      /value too long|too long for type|truncat/i.test(errorMessage)
    ) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Validation error',
          details: [{ field: 'callRemark', message: 'Remark exceeds allowed column length' }]
        }
      });
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

/**
 * §15-D — PATCH /hr/leads/uploads/:uploadId/dealers
 * Replace (or merge) the eligible dealer pool on an upload batch.
 * Does NOT reassign Assigned/Completed leads; FE calls assign-unassigned separately.
 */
export const updateHrUploadDealerPool = async (req: Request, res: Response): Promise<void> => {
  try {
    const uploadId = String(req.params.uploadId || req.params.batchId || req.params.id || '').trim();
    if (!uploadId) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: 'uploadId is required' }
      });
      return;
    }

    const batch = await CallingLeadUploadBatch.findByPk(uploadId);
    if (!batch) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_001', message: 'Upload not found' }
      });
      return;
    }

    const modeRaw = String(req.body?.mode ?? 'replace')
      .trim()
      .toLowerCase();
    const mode = modeRaw === 'add' ? 'add' : 'replace';

    const incoming = Array.from(
      new Set([
        ...parseDealerIds(req.body?.dealerIds),
        ...parseDealerIds(req.body?.dealer_ids),
        ...parseDealerIds(req.body?.['dealerIds[]'])
      ])
    );

    if (incoming.length === 0) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_002', message: 'Select at least one dealer' }
      });
      return;
    }

    const dealers = await Dealer.findAll({
      where: { id: { [Op.in]: incoming }, role: 'dealer', isActive: true },
      attributes: ['id', 'firstName', 'lastName']
    });
    const foundIds = new Set(dealers.map((d) => d.id));
    const missing = incoming.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_003',
          message: `Dealer not found or inactive: ${missing[0]}`,
          details: missing.map((id) => ({ field: 'dealerIds', message: `Invalid dealer id: ${id}` }))
        }
      });
      return;
    }

    const existing = extractDealerIdsFromBatchPool(batch.assignedDealers);
    const nextDealerIds =
      mode === 'add' ? Array.from(new Set([...existing, ...incoming])) : incoming;

    await batch.update({ assignedDealers: nextDealerIds });

    const dealerById = new Map(dealers.map((d) => [d.id, d]));
    // When mode=add, some ids may already be in pool but not in this request's findAll result set size —
    // re-fetch full next pool for names.
    const poolDealers =
      nextDealerIds.length === dealers.length
        ? dealers
        : await Dealer.findAll({
            where: { id: { [Op.in]: nextDealerIds } },
            attributes: ['id', 'firstName', 'lastName']
          });
    for (const d of poolDealers) dealerById.set(d.id, d);

    const dealersOut = nextDealerIds.map((id) => {
      const d = dealerById.get(id);
      const name = d
        ? `${d.firstName || ''} ${d.lastName || ''}`.trim() || id
        : id;
      return {
        id,
        name,
        firstName: d?.firstName || null,
        lastName: d?.lastName || null
      };
    });

    logInfo('HR upload dealer pool updated', {
      uploadId: batch.id,
      mode,
      dealerCount: nextDealerIds.length,
      userId: req.user?.id
    });

    emitRealtime(realtimeEvents.callingUploadsUpdated, {
      batchId: batch.id,
      assignedDealers: nextDealerIds,
      source: 'upload-dealers',
      mode,
      at: new Date().toISOString()
    });

    res.json({
      success: true,
      uploadId: batch.id,
      batchId: batch.id,
      dealerIds: nextDealerIds,
      dealers: dealersOut,
      mode,
      data: {
        uploadId: batch.id,
        batchId: batch.id,
        dealerIds: nextDealerIds,
        dealers: dealersOut,
        mode
      }
    });
  } catch (error) {
    logError('HR update upload dealer pool error', error, {
      uploadId: req.params.uploadId || req.params.batchId,
      userId: req.user?.id
    });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const assignHrUploadUnassigned = async (req: Request, res: Response): Promise<void> => {
  /**
   * §15-C / §15-D — POST /hr/leads/uploads/:uploadId/assign-unassigned
   * Default: active_cap (1 open lead / dealer) + rebalance.
   * Opt-in only: assignmentMode=round_robin_all (assigns every Unassigned row).
   */
  try {
    const uploadId = String(req.params.uploadId || req.params.batchId || '').trim();
    if (!uploadId) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: 'uploadId is required' }
      });
      return;
    }

    const batch = await CallingLeadUploadBatch.findByPk(uploadId);
    if (!batch) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_001', message: 'Upload not found' }
      });
      return;
    }

    let dealerIds = extractDealerIdsFromBatchPool(batch.assignedDealers);
    const bodyDealerIds = parseDealerIds(req.body?.dealerIds).length
      ? parseDealerIds(req.body?.dealerIds)
      : parseDealerIds(req.body?.['dealerIds[]']);
    if (bodyDealerIds.length) {
      dealerIds = bodyDealerIds;
    }

    if (!dealerIds.length) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_002',
          message: 'Upload has no dealer pool — re-upload with dealers selected'
        }
      });
      return;
    }

    const dealers = await Dealer.findAll({
      where: { id: { [Op.in]: dealerIds }, role: 'dealer', isActive: true },
      attributes: ['id']
    });
    if (!dealers.length) {
      res.status(400).json({
        success: false,
        error: { code: 'LEAD_006', message: 'No valid active dealers in pool' }
      });
      return;
    }
    dealerIds = dealers.map((d) => d.id);

    const rawMode = String(
      req.body?.assignmentMode ?? req.body?.assignment_mode ?? req.body?.mode ?? 'active_cap'
    )
      .trim()
      .toLowerCase();
    const assignAll =
      rawMode === 'round_robin_all' ||
      rawMode === 'round-robin-all' ||
      rawMode === 'all' ||
      rawMode === 'full';
    const assignmentMode = assignAll ? 'round_robin_all' : 'active_cap';
    const activeLimit = Math.max(
      1,
      Math.min(
        50,
        normalizeActiveLimitPerDealer(
          req.body?.activeLimitPerDealer ?? req.body?.activeLeadsLimit ?? DEFAULT_ACTIVE_LIMIT_PER_DEALER
        )
      )
    );
    // Default rebalance on for active_cap (FE sends rebalance: true). Explicit false skips demotion.
    const rebalance = !assignAll && req.body?.rebalance !== false;

    let assigned = 0;
    let released = 0;
    await sequelize.transaction(async (transaction) => {
      await ensureCallingPoolDealerExists(transaction);
      // Free hours-old stuck work into pool; active_cap rebalance handles over-cap separately.
      await reclaimStuckCallingAssignments(transaction);
      const assignedByUserId = await resolveAssignedByUserId(req, transaction);

      if (assignAll) {
        assigned = await roundRobinAssignUnassignedLeadsForBatch({
          batchId: batch.id,
          dealerIds,
          assignedByUserId,
          transaction
        });
      } else {
        const result = await activeCapAssignUnassignedLeadsForBatch({
          batchId: batch.id,
          dealerIds,
          assignedByUserId,
          activeLimit,
          rebalance,
          transaction
        });
        assigned = result.assigned;
        released = result.released;
      }
    });

    const countsMap = await buildHrUploadCountsForBatches([
      { id: batch.id, rowCount: batch.rowCount }
    ]);
    const liveCounts =
      countsMap.get(batch.id) || emptyHrUploadLeadCounts(batch.rowCount);

    logInfo('HR assign-unassigned completed', {
      uploadId: batch.id,
      assignmentMode,
      activeLimitPerDealer: assignAll ? null : activeLimit,
      rebalance,
      assigned,
      released,
      unassignedCount: liveCounts.unassignedCount,
      assignedCount: liveCounts.assignedCount,
      userId: req.user?.id
    });

    emitRealtime(realtimeEvents.callingUploadsUpdated, {
      batchId: batch.id,
      assignedAt: new Date().toISOString(),
      assignedDealers: dealerIds,
      source: 'assign-unassigned',
      assignmentMode
    });
    emitRealtime(realtimeEvents.callingActionsUpdated, {
      source: 'assign-unassigned',
      at: new Date().toISOString()
    });

    const countFields = hrUploadCountsToApi(liveCounts);
    const modeFields = {
      assignmentMode,
      activeLimitPerDealer: assignAll ? null : activeLimit,
      rebalance: assignAll ? false : rebalance,
      released
    };
    res.json({
      success: true,
      uploadId: batch.id,
      batchId: batch.id,
      assigned,
      unassignedRemaining: liveCounts.unassignedCount,
      ...modeFields,
      ...countFields,
      data: {
        uploadId: batch.id,
        batchId: batch.id,
        assigned,
        unassignedRemaining: liveCounts.unassignedCount,
        ...modeFields,
        ...countFields
      }
    });
  } catch (error) {
    logError('HR assign-unassigned error', error, {
      uploadId: req.params.uploadId || req.params.batchId,
      userId: req.user?.id
    });
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
          lastName: dealer.lastName,
          name: `${dealer.firstName || ''} ${dealer.lastName || ''}`.trim() || dealer.id
        }
      ])
    );

    const total = batches.count;
    const hrUploadsList = batches.rows.map((batch) => {
      const assignedDealers = Array.isArray(batch.assignedDealers) ? batch.assignedDealers : [];
      const liveCounts = countsByBatch.get(batch.id) || emptyHrUploadLeadCounts(batch.rowCount);
      return {
        id: batch.id,
        uploadedAt: batch.uploadedAt,
        fileName: batch.fileName,
        dealerIds: assignedDealers,
        dealers: assignedDealers
          .map((dealerId) => dealerById.get(String(dealerId)))
          .filter(
            (
              dealer
            ): dealer is {
              id: string;
              firstName: string;
              lastName: string;
              name: string;
            } => Boolean(dealer)
          ),
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
          const liveCounts = countsByBatch.get(batch.id) || emptyHrUploadLeadCounts(batch.rowCount);
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
              .filter(
                (
                  dealer
                ): dealer is {
                  id: string;
                  firstName: string;
                  lastName: string;
                  name: string;
                } => Boolean(dealer)
              ),
            assignedDealerDetails: assignedDealers.map((dealerId) => ({
              dealerId,
              dealerName: dealerById.has(String(dealerId))
                ? dealerById.get(String(dealerId))!.name
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

export const getHrLeadsSearchByMobile = async (req: Request, res: Response): Promise<void> => {
  /**
   * GET /api/hr/leads/search?mobile=9602209955&limit=100
   * Aliases: q / search for mobile.
   * Match last-10 digits of mobile or altMobile (contains / ends-with).
   */
  try {
    const mobileNeedle = resolveHrMobileSearchQuery(req.query);
    if (!mobileNeedle) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'mobile (or q / search) is required'
        }
      });
      return;
    }

    const limit = Math.min(parsePositiveInt(req.query.limit, 100), 200);

    const leads = await sequelize.query<{
      id: string;
      name: string;
      mobile: string;
      altMobile: string | null;
      kNumber: string | null;
      address: string | null;
      status: string | null;
      assignedDealerId: string | null;
      assignedDealerName: string | null;
      uploadId: string | null;
      fileName: string | null;
      uploadedAt: Date | string | null;
    }>(
      `
      SELECT
        cl."id" AS "id",
        cl."name" AS "name",
        cl."mobile" AS "mobile",
        cl."altMobile" AS "altMobile",
        cl."kNumber" AS "kNumber",
        cl."address" AS "address",
        dla."status" AS "status",
        CASE
          WHEN dla."dealerId" IS NOT NULL
            AND TRIM(dla."dealerId") <> ''
            AND LOWER(TRIM(dla."dealerId")) NOT IN (
              'unassigned', 'null', 'none', '-', 'na', 'n/a', 'pool', 'open'
            )
          THEN dla."dealerId"
          ELSE NULL
        END AS "assignedDealerId",
        CASE
          WHEN dla."dealerId" IS NOT NULL
            AND TRIM(dla."dealerId") <> ''
            AND LOWER(TRIM(dla."dealerId")) NOT IN (
              'unassigned', 'null', 'none', '-', 'na', 'n/a', 'pool', 'open'
            )
          THEN NULLIF(TRIM(CONCAT_WS(' ', d."firstName", d."lastName")), '')
          ELSE NULL
        END AS "assignedDealerName",
        cl."batchId" AS "uploadId",
        b."fileName" AS "fileName",
        b."uploadedAt" AS "uploadedAt"
      FROM "calling_leads" AS cl
      LEFT JOIN "calling_lead_upload_batches" AS b
        ON b."id" = cl."batchId"
      LEFT JOIN LATERAL (
        SELECT newer.*
        FROM "dealer_lead_assignments" AS newer
        WHERE newer."leadId" = cl."id"
        ORDER BY newer."assignedAt" DESC NULLS LAST, newer."createdAt" DESC NULLS LAST, newer."id" DESC
        LIMIT 1
      ) AS dla ON TRUE
      LEFT JOIN "dealers" AS d
        ON d."id" = dla."dealerId"
      WHERE ${callingLeadMobileSearchSql('cl', ':needle')}
      ORDER BY COALESCE(b."uploadedAt", cl."createdAt") DESC NULLS LAST, cl."createdAt" DESC
      LIMIT :limit
      `,
      {
        replacements: { needle: mobileNeedle, limit },
        type: QueryTypes.SELECT
      }
    );

    const payload = {
      success: true,
      mobile: mobileNeedle,
      total: leads.length,
      leads: leads.map((lead) => ({
        id: lead.id,
        name: lead.name || '',
        mobile: lead.mobile || '',
        altMobile: lead.altMobile || null,
        kNumber: lead.kNumber || null,
        address: lead.address || null,
        status: lead.status || 'queued',
        assignedDealerId: lead.assignedDealerId || null,
        assignedDealerName: lead.assignedDealerName || null,
        uploadId: lead.uploadId || null,
        fileName: lead.fileName || null,
        uploadedAt: lead.uploadedAt
          ? lead.uploadedAt instanceof Date
            ? lead.uploadedAt.toISOString()
            : String(lead.uploadedAt)
          : null
      }))
    };

    applyNoCacheHeaders(res);
    res.status(200).json({
      ...payload,
      data: payload
    });
  } catch (error) {
    logError('HR leads search by mobile error', error, {
      userId: req.user?.id,
      mobile: req.query.mobile ?? req.query.q ?? req.query.search
    });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const getHrLeadUploadBatchRows = async (req: Request, res: Response): Promise<void> => {
  try {
    const batchId = String(req.params.batchId || req.params.uploadId || '').trim();
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, 50), 100);
    const offset = (page - 1) * limit;
    const mobileNeedle = resolveHrMobileSearchQuery(req.query);

    const batch = await CallingLeadUploadBatch.findByPk(batchId);
    if (!batch) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Upload batch not found' }
      });
      return;
    }

    const rowWhere: WhereOptions = { batchId };
    if (mobileNeedle) {
      // needle is digits-only from extractMobileSearchNeedle — safe to embed
      const escapedNeedle = mobileNeedle.replace(/'/g, "''");
      const matchingLeadIds = (
        await sequelize.query<{ id: string }>(
          `
          SELECT cl."id" AS "id"
          FROM "calling_leads" AS cl
          WHERE cl."batchId" = :batchId
            AND ${callingLeadMobileSearchSql('cl', `:needle`)}
          `,
          {
            replacements: { batchId, needle: mobileNeedle },
            type: QueryTypes.SELECT
          }
        )
      ).map((row) => String(row.id));

      const mobileOr: any[] = [
        Sequelize.literal(
          `RIGHT(regexp_replace(COALESCE("CallingLeadUploadRow"."customerMobile", ''), '[^0-9]', '', 'g'), 10) LIKE '%${escapedNeedle}%'`
        )
      ];
      if (matchingLeadIds.length) {
        mobileOr.unshift({ leadId: { [Op.in]: matchingLeadIds } });
      }

      (rowWhere as any)[Op.and] = [{ [Op.or]: mobileOr }];
    }

    const rows = await CallingLeadUploadRow.findAndCountAll({
      where: rowWhere,
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
    const liveCounts = countsByBatch.get(batch.id) || emptyHrUploadLeadCounts(batch.rowCount);

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
        mobile: mobileNeedle || null,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 0,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        },
        totalRows: mobileNeedle ? total : liveCounts.rowCount
      },
      rows: normalizedRows,
      mobile: mobileNeedle || null,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      },
      totalRows: mobileNeedle ? total : liveCounts.rowCount
    });
  } catch (error) {
    logError('Get HR lead upload batch rows error', error, {
      userId: req.user?.id,
      batchId: req.params.batchId || req.params.uploadId
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

export const getAdminCallingActionsSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const summary = await buildCallingActionsSummaryOnly(req);
    res.json({
      success: true,
      data: {
        summary,
        interested: summary.interested,
        followUp: summary.followUp,
        notInterested: summary.notInterested,
        others: summary.others,
        total: summary.total
      }
    });
  } catch (error) {
    logError('Get admin calling actions summary error', error, { userId: req.user?.id });
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

export const getHrCallingActionsSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const summary = await buildCallingActionsSummaryOnly(req);
    res.json({
      success: true,
      data: {
        summary,
        interested: summary.interested,
        followUp: summary.followUp,
        notInterested: summary.notInterested,
        others: summary.others,
        total: summary.total
      }
    });
  } catch (error) {
    logError('Get HR calling actions summary error', error, { userId: req.user?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};
