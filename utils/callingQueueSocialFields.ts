import { Op } from 'sequelize';
import CallingLead from '../models/CallingLead';
import CallingLeadUploadBatch from '../models/CallingLeadUploadBatch';

type UploadBatchMeta = Pick<
  CallingLeadUploadBatch,
  'id' | 'fileName' | 'sourceType' | 'sourceSheetTab'
>;

export const loadUploadBatchMapByIds = async (
  batchIds: Array<string | null | undefined>
): Promise<Map<string, UploadBatchMeta>> => {
  const unique = [...new Set(batchIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!unique.length) return new Map();

  const rows = await CallingLeadUploadBatch.findAll({
    where: { id: { [Op.in]: unique } },
    attributes: ['id', 'fileName', 'sourceType', 'sourceSheetTab']
  });

  return new Map(rows.map((row) => [row.id, row]));
};

/** Echo Meta / Google Sheet fields on dealer calling-queue lead rows. */
export const buildDealerQueueSocialFields = (
  lead: CallingLead | null | undefined,
  batch?: UploadBatchMeta | null
): Record<string, unknown> => {
  if (!lead) return {};

  const sourceType = String(batch?.sourceType || '').trim() || (lead.sheetSourceId ? 'google_sheet' : '');
  const platform = String(lead.platform || '').trim().toLowerCase();
  const isSocial =
    sourceType === 'google_sheet' ||
    Boolean(lead.sheetSourceId) ||
    platform === 'ig' ||
    platform === 'fb' ||
    platform === 'meta' ||
    platform === 'instagram' ||
    platform === 'facebook';

  if (!isSocial) return {};

  const uploadFileName = batch?.fileName || null;
  const leadStatus = lead.sheetLeadStatus || null;

  return {
    sourceType: sourceType || 'google_sheet',
    source_type: sourceType || 'google_sheet',
    uploadFileName,
    upload_file_name: uploadFileName,
    fileName: uploadFileName,
    file_name: uploadFileName,
    sheetSourceId: lead.sheetSourceId || null,
    sheet_source_id: lead.sheetSourceId || null,
    sourceSheetTab: batch?.sourceSheetTab || null,
    source_sheet_tab: batch?.sourceSheetTab || null,
    platform: lead.platform || null,
    leadStatus,
    lead_status: leadStatus,
    sheetLeadStatus: leadStatus,
    sheet_lead_status: leadStatus,
    campaignName: lead.campaignName || null,
    campaign_name: lead.campaignName || null,
    adName: lead.adName || null,
    ad_name: lead.adName || null,
    remarks: lead.remarks || null,
    remarks2: lead.remarks2 || null,
    remarks_2: lead.remarks2 || null,
    kw: lead.kNumber || null,
    kNumber: lead.kNumber || null,
    firstCallResponse: lead.firstCallResponse || null,
    first_call_response: lead.firstCallResponse || null,
    secondCallResponse: lead.secondCallResponse || null,
    second_call_response: lead.secondCallResponse || null,
    externalId: lead.externalId || null,
    external_id: lead.externalId || null,
    finalDecision: lead.finalDecision || null,
    final_decision: lead.finalDecision || null,
    finalDecisionReason: lead.finalDecisionReason || null,
    final_decision_reason: lead.finalDecisionReason || null,
    assignedPersonName: lead.assignedPersonName || null,
    assigned_person_name: lead.assignedPersonName || null,
    loginFlag: lead.loginFlag ?? null,
    login_flag: lead.loginFlag ?? null,
    raw: lead.rawPayload || null,
    raw_json: lead.rawPayload || null
  };
};
