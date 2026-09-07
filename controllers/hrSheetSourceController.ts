import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import CallingLeadSheetSource from '../models/CallingLeadSheetSource';
import CallingLeadUploadBatch from '../models/CallingLeadUploadBatch';
import CallingLead from '../models/CallingLead';
import DealerLeadAssignment from '../models/DealerLeadAssignment';
import { Dealer } from '../models/index-quotation';
import { logError } from '../utils/loggerHelper';
import {
  asDealerIdArray,
  getSheetsClient,
  syncSheetTabSource,
  GoogleSheetsNotConfiguredError,
  resolveSpreadsheetId
} from '../utils/hrSheetSourceSync';
import { mapSheetSourceForApi, mapSocialLeadForApi } from '../utils/hrSheetSourceApi';
import { fetchHrUploadBatchCounts, isValidHrCallingAssigneeDealerId, resolveAssignedByUserId } from './callingLeadController';
import { sequelize, User } from '../models';
import { emitRealtime, realtimeEvents } from '../utils/realtime';

const parsePositiveInt = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

const sheetSourceCounts = async (source: CallingLeadSheetSource) => {
  if (source.uploadId) {
    const batch = await CallingLeadUploadBatch.findByPk(source.uploadId, {
      attributes: ['rowCount']
    });
    return fetchHrUploadBatchCounts(source.uploadId, batch?.rowCount || 0);
  }
  const leadCount = await CallingLead.count({ where: { sheetSourceId: source.id } });
  return {
    rowCount: leadCount,
    leadCount,
    skippedDuplicate: 0,
    assignedCount: 0,
    unassignedCount: leadCount,
    completedCount: 0
  };
};

export const listHrSheetSources = async (req: Request, res: Response): Promise<void> => {
  try {
    const query = (req.query && typeof req.query === 'object' ? req.query : {}) as Record<string, unknown>;
    const spreadsheetId = resolveSpreadsheetId(query.spreadsheetId ?? query.spreadsheet_id);

    // Only sources for the configured / requested spreadsheet (no stale tabs from old sheets).
    const rows = await CallingLeadSheetSource.findAll({
      where: { spreadsheetId },
      order: [['sheetTabName', 'ASC']]
    });
    const sources = [];
    for (const row of rows) {
      const counts = await sheetSourceCounts(row);
      sources.push(mapSheetSourceForApi(row, counts));
    }
    res.json({
      success: true,
      data: { spreadsheetId, sources },
      sources,
      tabs: rows.map((r) => r.sheetTabName)
    });
  } catch (error) {
    logError('listHrSheetSources error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const discoverHrSheetTabs = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const spreadsheetId = resolveSpreadsheetId(body.spreadsheetId ?? body.spreadsheet_id);

    const sheets = getSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const tabs = (meta.data.sheets || [])
      .map((s) => s.properties?.title)
      .filter((title): title is string => Boolean(title));

    // Upsert live tabs, then delete DB rows for renamed/removed Google tabs (UI must match 1:1).
    const live: CallingLeadSheetSource[] = [];
    for (const tab of tabs) {
      const [row] = await CallingLeadSheetSource.findOrCreate({
        where: { spreadsheetId, sheetTabName: tab },
        defaults: {
          id: uuidv4(),
          displayName: tab.replace(/_/g, ' '),
          enabled: false,
          dealerIds: [],
          activeLimitPerDealer: 1,
          lastSyncedRow: 1
        }
      });
      live.push(row);
    }

    const staleWhere: Record<string, unknown> = { spreadsheetId };
    if (tabs.length) {
      staleWhere.sheetTabName = { [Op.notIn]: tabs };
    }
    const deleted = await CallingLeadSheetSource.destroy({ where: staleWhere });

    const sources = [];
    for (const row of live) {
      const counts = await sheetSourceCounts(row);
      sources.push(mapSheetSourceForApi(row, counts));
    }

    res.json({
      success: true,
      data: {
        spreadsheetId,
        tabs,
        sources,
        deleted
      },
      sources,
      tabs
    });
  } catch (error) {
    if (error instanceof GoogleSheetsNotConfiguredError) {
      res.status(503).json({
        success: false,
        error: { code: error.code, message: error.message }
      });
      return;
    }
    logError('discoverHrSheetTabs error', error);
    const message = error instanceof Error ? error.message : 'Failed to discover sheet tabs';
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message }
    });
  }
};

export const patchHrSheetSource = async (req: Request, res: Response): Promise<void> => {
  try {
    const row = await CallingLeadSheetSource.findByPk(req.params.id);
    if (!row) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Sheet source not found' }
      });
      return;
    }

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (body.enabled !== undefined) {
      const v = body.enabled;
      patch.enabled = v === true || v === 'true' || v === 1 || v === '1';
    }
    if (body.dealerIds !== undefined || body.dealer_ids !== undefined) {
      patch.dealerIds = asDealerIdArray(body.dealerIds ?? body.dealer_ids);
    }
    if (body.activeLimitPerDealer !== undefined || body.active_limit_per_dealer !== undefined) {
      patch.activeLimitPerDealer = Math.max(
        1,
        Math.min(50, Number(body.activeLimitPerDealer ?? body.active_limit_per_dealer) || 1)
      );
    }
    if (body.displayName !== undefined || body.display_name !== undefined) {
      patch.displayName = String(body.displayName ?? body.display_name ?? row.displayName).trim();
    }

    await row.update(patch);
    await row.reload();

    if (row.uploadId && (body.dealerIds !== undefined || body.dealer_ids !== undefined)) {
      const upload = await CallingLeadUploadBatch.findByPk(row.uploadId);
      if (upload) {
        await upload.update({ assignedDealers: asDealerIdArray(row.dealerIds) });
      }
    }

    const counts = await sheetSourceCounts(row);
    res.json({ success: true, data: mapSheetSourceForApi(row, counts) });
  } catch (error) {
    logError('patchHrSheetSource error', error, { id: req.params.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

export const postHrSheetSourceSync = async (req: Request, res: Response): Promise<void> => {
  try {
    const row = await CallingLeadSheetSource.findByPk(req.params.id);
    if (!row) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Sheet source not found' }
      });
      return;
    }

    const assignedByUserId = await sequelize.transaction((transaction) =>
      resolveAssignedByUserId(req, transaction)
    );
    const result = await syncSheetTabSource(row, { assignedByUserId });
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof GoogleSheetsNotConfiguredError) {
      res.status(503).json({
        success: false,
        error: { code: error.code, message: error.message }
      });
      return;
    }
    logError('postHrSheetSourceSync error', error, { id: req.params.id });
    const row = await CallingLeadSheetSource.findByPk(req.params.id);
    if (row) {
      await row.update({
        lastSyncStatus: 'error',
        lastSyncError: error instanceof Error ? error.message : 'Sync failed',
        lastSyncedAt: new Date()
      });
    }
    res.status(500).json({
      success: false,
      error: {
        code: 'SYS_001',
        message: error instanceof Error ? error.message : 'Sync failed'
      }
    });
  }
};

/**
 * POST /hr/sheet-sources/sync-all
 * Cron / HR: sync every enabled sheet source for the spreadsheet.
 * Auth: HR JWT (via route middleware) OR x-cron-secret === CRON_SECRET.
 */
export const postHrSheetSourcesSyncAll = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const spreadsheetId = resolveSpreadsheetId(body.spreadsheetId ?? body.spreadsheet_id);

    // Keep DB tabs aligned with Google before syncing (same prune as Discover).
    try {
      const sheets = getSheetsClient();
      const meta = await sheets.spreadsheets.get({ spreadsheetId });
      const liveTabs = (meta.data.sheets || [])
        .map((s) => s.properties?.title)
        .filter((title): title is string => Boolean(title));
      if (liveTabs.length) {
        await CallingLeadSheetSource.destroy({
          where: {
            spreadsheetId,
            sheetTabName: { [Op.notIn]: liveTabs }
          }
        });
      }
    } catch (error) {
      if (error instanceof GoogleSheetsNotConfiguredError) throw error;
      logError('sync-all live-tab prune failed (continuing)', error, { spreadsheetId });
    }

    let assignedByUserId = '1';
    try {
      assignedByUserId = await sequelize.transaction((transaction) =>
        resolveAssignedByUserId(req, transaction)
      );
    } catch {
      const fallback = await User.findOne({
        where: {
          role: { [Op.in]: ['super-admin', 'super-admin-manager', 'admin'] },
          is_active: true
        },
        attributes: ['id'],
        order: [['created_at', 'ASC']]
      });
      if (fallback?.id) assignedByUserId = fallback.id;
    }

    const sources = await CallingLeadSheetSource.findAll({
      where: { spreadsheetId, enabled: true },
      order: [['sheetTabName', 'ASC']]
    });

    const results: Array<Record<string, unknown>> = [];
    for (const row of sources) {
      try {
        const result = await syncSheetTabSource(row, { assignedByUserId });
        results.push({
          id: row.id,
          sheetTabName: row.sheetTabName,
          sheet_tab_name: row.sheetTabName,
          ok: true,
          ...result
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Sync failed';
        await row.update({
          lastSyncStatus: 'error',
          lastSyncError: message,
          lastSyncedAt: new Date()
        });
        results.push({
          id: row.id,
          sheetTabName: row.sheetTabName,
          sheet_tab_name: row.sheetTabName,
          ok: false,
          error: message
        });
      }
    }

    const syncedAt = new Date().toISOString();
    emitRealtime(realtimeEvents.callingUploadsUpdated, {
      reason: 'sheet_auto_sync',
      spreadsheetId,
      syncedAt,
      count: results.length,
      source: 'google-sheet-sync-all'
    });

    res.json({
      success: true,
      data: {
        spreadsheetId,
        syncedAt,
        sources: results
      }
    });
  } catch (error) {
    if (error instanceof GoogleSheetsNotConfiguredError) {
      res.status(503).json({
        success: false,
        error: { code: error.code, message: error.message }
      });
      return;
    }
    logError('postHrSheetSourcesSyncAll error', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SYS_001',
        message: error instanceof Error ? error.message : 'Sync-all failed'
      }
    });
  }
};

export const getHrSheetSourceLeads = async (req: Request, res: Response): Promise<void> => {
  try {
    const row = await CallingLeadSheetSource.findByPk(req.params.id);
    if (!row) {
      res.status(404).json({
        success: false,
        error: { code: 'RES_001', message: 'Sheet source not found' }
      });
      return;
    }

    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, 50), 250);
    const offset = (page - 1) * limit;

    const { rows, count } = await CallingLead.findAndCountAll({
      where: { sheetSourceId: row.id },
      order: [['createdAt', 'DESC']],
      offset,
      limit
    });

    const leadIds = rows.map((r) => r.id);
    const assignments = leadIds.length
      ? await DealerLeadAssignment.findAll({
          where: { leadId: { [Op.in]: leadIds } },
          order: [
            ['assignedAt', 'DESC'],
            ['createdAt', 'DESC']
          ]
        })
      : [];

    const assignmentByLeadId = new Map<string, DealerLeadAssignment>();
    for (const assignment of assignments) {
      if (!assignmentByLeadId.has(assignment.leadId)) {
        assignmentByLeadId.set(assignment.leadId, assignment);
      }
    }

    const dealerIds = [
      ...new Set(
        assignments
          .map((a) => a.dealerId)
          .filter((id) => isValidHrCallingAssigneeDealerId(id))
      )
    ];
    const dealers = dealerIds.length
      ? await Dealer.findAll({
          where: { id: { [Op.in]: dealerIds } },
          attributes: ['id', 'firstName', 'lastName']
        })
      : [];
    const dealerNameById = Object.fromEntries(
      dealers.map((d) => [d.id, `${d.firstName || ''} ${d.lastName || ''}`.trim() || d.id])
    );

    const mappedRows = rows.map((lead) =>
      mapSocialLeadForApi(lead, assignmentByLeadId.get(lead.id), dealerNameById, row.sheetTabName)
    );

    res.json({
      success: true,
      data: {
        source: mapSheetSourceForApi(row, await sheetSourceCounts(row)),
        rows: mappedRows,
        leads: mappedRows,
        pagination: { page, limit, total: count }
      }
    });
  } catch (error) {
    logError('getHrSheetSourceLeads error', error, { id: req.params.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};
