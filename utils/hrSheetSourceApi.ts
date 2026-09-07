import CallingLeadSheetSource from '../models/CallingLeadSheetSource';
import CallingLead from '../models/CallingLead';
import DealerLeadAssignment from '../models/DealerLeadAssignment';
import { HrUploadLeadCounts } from '../controllers/callingLeadController';
import { asDealerIdArray } from './hrSheetSourceSync';

export { buildDealerQueueSocialFields, loadUploadBatchMapByIds } from './callingQueueSocialFields';

export const mapSheetSourceForApi = (
  row: CallingLeadSheetSource,
  counts?: Partial<HrUploadLeadCounts> & { rowCount?: number }
) => ({
  id: row.id,
  spreadsheetId: row.spreadsheetId,
  spreadsheet_id: row.spreadsheetId,
  sheetTabName: row.sheetTabName,
  sheet_tab_name: row.sheetTabName,
  displayName: row.displayName,
  display_name: row.displayName,
  enabled: row.enabled,
  dealerIds: asDealerIdArray(row.dealerIds),
  dealer_ids: asDealerIdArray(row.dealerIds),
  activeLimitPerDealer: row.activeLimitPerDealer ?? 1,
  active_limit_per_dealer: row.activeLimitPerDealer ?? 1,
  lastSyncedAt: row.lastSyncedAt ?? null,
  last_synced_at: row.lastSyncedAt ?? null,
  lastSyncStatus: row.lastSyncStatus ?? null,
  last_sync_status: row.lastSyncStatus ?? null,
  lastSyncError: row.lastSyncError ?? null,
  last_sync_error: row.lastSyncError ?? null,
  uploadId: row.uploadId ?? null,
  upload_id: row.uploadId ?? null,
  rowCount: counts?.rowCount ?? counts?.leadCount ?? 0,
  assignedCount: counts?.assignedCount ?? 0,
  unassignedCount: counts?.unassignedCount ?? 0,
  completedCount: counts?.completedCount ?? 0,
  sourceType: 'google_sheet' as const
});

export const mapSocialLeadForApi = (
  lead: CallingLead,
  assignment: DealerLeadAssignment | null | undefined,
  dealerNameById: Record<string, string>,
  sourceTab?: string | null
) => {
  const assignedDealerId =
    assignment &&
    assignment.dealerId &&
    !['unassigned', 'pool', 'open', 'null', 'none', '-', 'na', 'n/a'].includes(
      String(assignment.dealerId).trim().toLowerCase()
    )
      ? String(assignment.dealerId)
      : null;
  const status = assignment?.status || 'queued';

  return {
    id: lead.id,
    externalId: lead.externalId,
    external_id: lead.externalId,
    name: lead.name,
    mobile: lead.mobile,
    address: lead.address,
    city: lead.city,
    customerNote: lead.customerNote,
    customer_note: lead.customerNote,
    platform: lead.platform,
    campaignName: lead.campaignName,
    campaign_name: lead.campaignName,
    adName: lead.adName,
    ad_name: lead.adName,
    leadStatus: lead.sheetLeadStatus,
    lead_status: lead.sheetLeadStatus,
    remarks: lead.remarks,
    remarks2: lead.remarks2,
    remarks_2: lead.remarks2,
    kw: lead.kNumber,
    assignedPersonName: lead.assignedPersonName,
    assigned_person_name: lead.assignedPersonName,
    firstCallResponse: lead.firstCallResponse,
    first_call_response: lead.firstCallResponse,
    secondCallResponse: lead.secondCallResponse,
    second_call_response: lead.secondCallResponse,
    loginFlag: lead.loginFlag,
    login_flag: lead.loginFlag,
    finalDecision: lead.finalDecision,
    final_decision: lead.finalDecision,
    finalDecisionReason: lead.finalDecisionReason,
    final_decision_reason: lead.finalDecisionReason,
    createdTime: lead.sheetCreatedTime ?? lead.createdAt,
    created_time: lead.sheetCreatedTime ?? lead.createdAt,
    assignedDealerId,
    assigned_dealer_id: assignedDealerId,
    assignedDealerName: assignedDealerId ? dealerNameById[assignedDealerId] || null : null,
    assigned_dealer_name: assignedDealerId ? dealerNameById[assignedDealerId] || null : null,
    assignmentStatus: status,
    assignment_status: status,
    status,
    sourceTab: sourceTab ?? null,
    source_tab: sourceTab ?? null,
    raw: lead.rawPayload
  };
};
