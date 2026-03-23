import { Request, Response } from 'express';
import { Op, Sequelize } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import XLSX from 'xlsx';
import { CallingLead, DealerLeadAssignment, User, sequelize } from '../models';
import { Dealer } from '../models/index-quotation';
import { logError, logInfo } from '../utils/loggerHelper';

const MOBILE_KEYS = ['mobile', 'phone', 'contact', 'contact no', 'contact no.', 'contactnumber', 'phone_number', 'phone number', 'mobile number'];
const NAME_KEYS = ['name', 'customername', 'customer name', 'full name'];
const ALT_MOBILE_KEYS = ['altmobile', 'alternate mobile', 'alternate_mobile', 'secondary mobile'];
const K_NUMBER_KEYS = ['k number', 'knumber', 'k_number', 'k no', 'kno'];
const ADDRESS_KEYS = ['address'];
const CITY_KEYS = ['city'];
const STATE_KEYS = ['state', 'data ref. / state', 'data ref/state', 'data ref state'];
const NOTE_KEYS = ['customernote', 'customer note', 'note', 'notes', 'remark', 'remarks'];
const ACTIVE_STATUSES = ['assigned', 'in_progress', 'rescheduled'];
const ACTIONABLE_STATUSES = ['assigned', 'in_progress', 'rescheduled'];
const DEFAULT_ACTIVE_LIMIT_PER_DEALER = Number(process.env.ACTIVE_LIMIT_PER_DEALER || 8);

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
  const activeCount = await DealerLeadAssignment.count({
    where: {
      dealerId,
      status: { [Op.in]: ACTIVE_STATUSES }
    },
    transaction
  });

  if (activeCount >= activeLimitPerDealer) return;

  const queued = await DealerLeadAssignment.findOne({
    where: {
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

    const dealerIds = parseDealerIds(req.body.dealerIds);
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
    const normalizedRows: Array<{
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
    const duplicateInFile = new Set<string>();
    const seenMobiles = new Set<string>();

    for (const row of rows) {
      const mobileRaw = extractCell(row, MOBILE_KEYS);
      const mobile = normalizeMobile(mobileRaw);
      if (!mobile) continue;

      if (seenMobiles.has(mobile)) {
        duplicateInFile.add(mobile);
        continue;
      }
      seenMobiles.add(mobile);

      const name = String(extractCell(row, NAME_KEYS) || '').trim() || 'Unknown';
      const altMobile = normalizeMobile(extractCell(row, ALT_MOBILE_KEYS));
      const kNumber = String(extractCell(row, K_NUMBER_KEYS) || '').trim() || null;
      const address = String(extractCell(row, ADDRESS_KEYS) || '').trim() || null;
      const city = String(extractCell(row, CITY_KEYS) || '').trim() || null;
      const state = String(extractCell(row, STATE_KEYS) || '').trim() || null;
      const customerNote = String(extractCell(row, NOTE_KEYS) || '').trim() || null;

      normalizedRows.push({
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

    let created = 0;
    let assigned = 0;
    let queued = 0;
    let activeDealerPointer = 0;
    let queuedDealerPointer = 0;

    await sequelize.transaction(async (transaction) => {
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
        created,
        skippedDuplicate,
        assigned,
        queued,
        activeLimitPerDealer
      }
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

  // Priority order without raw SQL literals:
  // 1) due rescheduled leads, 2) in-progress, 3) assigned.
  const assignment =
    await DealerLeadAssignment.findOne({
      where: {
        dealerId,
        status: 'rescheduled',
        nextFollowUpAt: { [Op.lte]: now }
      },
      include: sharedInclude,
      order: [['nextFollowUpAt', 'ASC'], ['assignedAt', 'ASC']]
    }) ||
    await DealerLeadAssignment.findOne({
      where: {
        dealerId,
        status: 'in_progress'
      },
      include: sharedInclude,
      order: [['assignedAt', 'ASC']]
    }) ||
    await DealerLeadAssignment.findOne({
      where: {
        dealerId,
        status: 'assigned'
      },
      include: sharedInclude,
      order: [['assignedAt', 'ASC']]
    });

  const lead = assignment ? (assignment as any).lead : null;
  if (!assignment || !lead) return null;

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
    nextFollowUpAt: row.nextFollowUpAt,
    status: row.status
  }));
};

const buildRecentActions = async (dealerId: string) => {
  const rows = await DealerLeadAssignment.findAll({
    where: {
      dealerId,
      action: { [Op.ne]: null }
    },
    include: [{ model: CallingLead, as: 'lead' }],
    order: [['actionAt', 'DESC'], ['updatedAt', 'DESC']],
    limit: 30
  });

  return rows.map((row: any) => ({
    leadId: row.leadId,
    name: row.lead?.name || '',
    mobile: row.lead?.mobile || '',
    action: row.action,
    actionAt: row.actionAt,
    callRemark: row.callRemark,
    nextFollowUpAt: row.nextFollowUpAt,
    status: row.status
  }));
};

const buildDealerQueueSnapshot = async (dealerId: string) => {
  const [lead, counts, scheduledLeads, recentActions] = await Promise.all([
    buildCurrentLeadResponse(dealerId),
    buildDealerQueueCounts(dealerId),
    buildScheduledLeads(dealerId),
    buildRecentActions(dealerId)
  ]);

  return {
    lead,
    nextLead: lead,
    ...counts,
    scheduledLeads,
    recentActions
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

    const snapshot = await buildDealerQueueSnapshot(req.dealer.id);

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
    const { action, callRemark, nextFollowUpAt, actionAt } = req.body as {
      action: 'start' | 'called' | 'follow_up' | 'not_interested' | 'rescheduled';
      callRemark?: string;
      nextFollowUpAt?: string;
      actionAt?: string;
    };

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

      if (!ACTIONABLE_STATUSES.includes(assignment.status)) {
        const error: any = new Error('INVALID_TRANSITION');
        error.code = 'LEAD_005';
        throw error;
      }

      const effectiveActionAt = actionDate || new Date();
      if (action === 'start') {
        if (assignment.status !== 'assigned') {
          const error: any = new Error('INVALID_TRANSITION');
          error.code = 'LEAD_005';
          throw error;
        }

        await assignment.update({
          status: 'in_progress',
          action: null,
          callRemark: callRemark || assignment.callRemark || null,
          actionAt: effectiveActionAt
        }, { transaction });
      } else if (action === 'rescheduled') {
        await assignment.update({
          status: 'rescheduled',
          action,
          callRemark: callRemark || null,
          nextFollowUpAt: followUpDate,
          actionAt: effectiveActionAt
        }, { transaction });
      } else {
        await assignment.update({
          status: 'completed',
          action,
          callRemark: callRemark || null,
          actionAt: effectiveActionAt
        }, { transaction });
      }

      // Refill active slot only when work is completed.
      // Rescheduled leads stay with the same dealer and keep occupying an active slot.
      if (action === 'called' || action === 'not_interested' || action === 'follow_up') {
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
        ...(await buildDealerQueueSnapshot(req.dealer.id))
      }
    });
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
      where: { role: 'dealer', isActive: true },
      attributes: ['id', 'firstName', 'lastName', 'mobile', 'email'],
      order: [['firstName', 'ASC']]
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
          email: dealer.email
        }))
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
