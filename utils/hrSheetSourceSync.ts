import { google, sheets_v4 } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import CallingLeadSheetSource from '../models/CallingLeadSheetSource';
import CallingLeadUploadBatch from '../models/CallingLeadUploadBatch';
import CallingLead from '../models/CallingLead';
import { assignUploadBatchWithActiveCap } from '../controllers/callingLeadController';
import { emitRealtime, realtimeEvents } from './realtime';
import { logError } from './loggerHelper';
import fs from 'fs';
import path from 'path';

export const DEFAULT_SPREADSHEET_ID = '18zqPIpa3fcjRvfNqdm3FPC10bszPIPHbv5F3-TMk0A0';

/** Local/server key file (gitignored). Prefer env override. */
export const DEFAULT_GOOGLE_SHEETS_CREDENTIALS_PATH = path.join(
  process.cwd(),
  'secrets',
  'google-sheets-service-account.json'
);

export type MappedSheetLead = {
  externalId: string | null;
  name: string;
  mobile: string;
  address: string;
  city: string | null;
  platform: string;
  campaignName: string;
  adName: string;
  sheetLeadStatus: string;
  remarks: string;
  remarks2: string;
  kw: string;
  assignedPersonName: string;
  firstCallResponse: string;
  secondCallResponse: string;
  loginFlag: boolean;
  finalDecision: string;
  finalDecisionReason: string;
  sheetCreatedTime: Date | null;
  customerNote: string;
  raw: Record<string, string>;
  sheetRowIndex: number;
};

export const asDealerIdArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((v) => String(v || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.map((v) => String(v || '').trim()).filter(Boolean)
        : [value.trim()];
    } catch {
      return [value.trim()];
    }
  }
  return [];
};

const normalizeHeader = (h: unknown): string =>
  String(h || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export const normalizeSheetMobile = (value: unknown): string => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
};

const parseSheetDate = (value: unknown): Date | null => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const cityFromTabName = (tab: string): string | null => {
  // "Ajmer Leads" / "Ajmer_Leads" / "Ajmer Solar Lead Form New" → Ajmer
  const first = String(tab || '')
    .trim()
    .split(/[\s_]+/)
    .filter(Boolean)[0];
  return first || null;
};

const pickRaw = (raw: Record<string, string>, ...aliases: string[]): string => {
  for (const alias of aliases) {
    const v = raw[normalizeHeader(alias)];
    if (v) return v;
  }
  return '';
};

export const rowToLeadObject = (
  headers: string[],
  values: unknown[],
  sheetTabName: string
): MappedSheetLead | null => {
  const raw: Record<string, string> = {};
  headers.forEach((h, i) => {
    raw[normalizeHeader(h)] = String(values[i] ?? '').trim();
  });

  // Meta: phone_number like p:+918955276223 → last 10 digits
  const mobile = normalizeSheetMobile(
    pickRaw(raw, 'phone_number', 'phonenumber', 'phone', 'mobile', 'contact')
  );
  if (mobile.length !== 10) return null;

  const campaignName = pickRaw(raw, 'campaign_name', 'campaign');
  const adName = pickRaw(raw, 'ad_name', 'ad');
  const formName = pickRaw(raw, 'form_name', 'form');
  const adsetName = pickRaw(raw, 'adset_name');

  // Meta: full_name = customer. Optional ops column NAME = assignee (not assignment source).
  const fullName = pickRaw(raw, 'full_name', 'fullname', 'customername');
  const nameCol = pickRaw(raw, 'name');
  const customerName = fullName || nameCol || 'Unknown';
  const assignedPersonName =
    pickRaw(raw, 'assigned_person', 'assignedperson') ||
    (fullName && nameCol && nameCol !== fullName ? nameCol : '');

  return {
    externalId: pickRaw(raw, 'id', 'lead_id', 'external_id') || null,
    name: customerName,
    mobile,
    address: [pickRaw(raw, 'street_address', 'address', 'street'), pickRaw(raw, 'post_code', 'postcode', 'pincode')]
      .filter(Boolean)
      .join(', '),
    city: cityFromTabName(sheetTabName) || pickRaw(raw, 'city', 'location') || null,
    // Store Meta platform (ig/fb); ignore is_organic as a platform substitute
    platform: pickRaw(raw, 'platform'),
    campaignName,
    adName,
    sheetLeadStatus: pickRaw(raw, 'lead_status', 'status'),
    remarks: pickRaw(raw, 'remarks', 'remark', 'note'),
    remarks2: pickRaw(raw, 'remarks2', 'remarks 2'),
    kw: pickRaw(raw, 'kw', 'systemkw', 'capacity'),
    assignedPersonName,
    firstCallResponse: pickRaw(raw, '1stcallresponse', 'firstcallresponse', '1st Call Response'),
    secondCallResponse: pickRaw(raw, '2ndcallresponse', 'secondcallresponse', '2nd Call Response'),
    loginFlag: ['true', 'yes', '1', 'y'].includes(
      pickRaw(raw, 'login', 'filelogin').toLowerCase()
    ),
    finalDecision: pickRaw(raw, 'finaldecison', 'finaldecision', 'final decision'),
    finalDecisionReason: pickRaw(raw, 'reasonoffinaldecision', 'reason of final decision'),
    sheetCreatedTime: parseSheetDate(pickRaw(raw, 'created_time', 'createdat', 'created')),
    // form_name / adset_name enrich note only; ad_id / campaign_id etc. stay in raw
    customerNote: [campaignName, adName, formName, adsetName].filter(Boolean).join(' · '),
    raw,
    sheetRowIndex: 0
  };
};

export class GoogleSheetsNotConfiguredError extends Error {
  code = 'CFG_GOOGLE_SHEETS';

  constructor(
    message = 'Google Sheets credentials missing: set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS, or place the key at secrets/google-sheets-service-account.json'
  ) {
    super(message);
    this.name = 'GoogleSheetsNotConfiguredError';
  }
}

export const resolveSpreadsheetId = (raw?: unknown): string => {
  const fromEnv = String(process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '').trim();
  if (fromEnv) return fromEnv;
  const fromBody = String(raw || '').trim();
  if (fromBody) return fromBody;
  return DEFAULT_SPREADSHEET_ID;
};

const resolveGoogleSheetsKeyFile = (): string | null => {
  const candidates = [
    String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim(),
    DEFAULT_GOOGLE_SHEETS_CREDENTIALS_PATH,
    path.join(__dirname, '..', 'secrets', 'google-sheets-service-account.json')
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

export const getSheetsClient = (): sheets_v4.Sheets => {
  // 1) Inline JSON from .env (never commit the value)
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (json && json.trim()) {
    let credentials: Record<string, unknown>;
    try {
      credentials = JSON.parse(json);
    } catch {
      throw new GoogleSheetsNotConfiguredError(
        'GOOGLE_SERVICE_ACCOUNT_JSON is set but is not valid JSON'
      );
    }
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
    return google.sheets({ version: 'v4', auth });
  }

  // 2) Key file path from .env or secrets/ (gitignored — not in git)
  const keyFile = resolveGoogleSheetsKeyFile();
  if (!keyFile) {
    throw new GoogleSheetsNotConfiguredError();
  }
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  return google.sheets({ version: 'v4', auth });
};

export const createOrGetSheetUploadBatch = async (
  sourceRow: CallingLeadSheetSource
): Promise<CallingLeadUploadBatch> => {
  const tab = sourceRow.sheetTabName;
  if (sourceRow.uploadId) {
    const existing = await CallingLeadUploadBatch.findByPk(sourceRow.uploadId);
    if (existing) {
      const displayName = String(sourceRow.displayName || tab.replace(/_/g, ' ')).trim() || tab;
      const expectedFileName = `Google Sheet: ${displayName}`;
      if (existing.fileName !== expectedFileName) {
        await existing.update({ fileName: expectedFileName });
      }
      return existing;
    }
  }

  const displayName = String(sourceRow.displayName || tab.replace(/_/g, ' ')).trim() || tab;
  const batch = await CallingLeadUploadBatch.create({
    id: uuidv4(),
    fileName: `Google Sheet: ${displayName}`,
    uploadedBy: 'google-sheet',
    uploadedAt: new Date(),
    rowCount: 0,
    assignedDealers: asDealerIdArray(sourceRow.dealerIds),
    sourceType: 'google_sheet',
    sourceSheetTab: tab
  });

  await sourceRow.update({ uploadId: batch.id });
  return batch;
};

const isUniqueConstraintError = (error: unknown): boolean => {
  const name = (error as { name?: string })?.name || '';
  return name === 'SequelizeUniqueConstraintError' || name === 'UniqueConstraintError';
};

export const syncSheetTabSource = async (
  sourceRow: CallingLeadSheetSource,
  { assignLeads = true, assignedByUserId = '1' }: { assignLeads?: boolean; assignedByUserId?: string } = {}
): Promise<{
  imported: number;
  skipped: number;
  assigned: number;
  uploadId: string;
  message?: string;
}> => {
  const sheets = getSheetsClient();
  const spreadsheetId = resolveSpreadsheetId(sourceRow.spreadsheetId);
  const tab = sourceRow.sheetTabName;
  const startRow = Number(sourceRow.lastSyncedRow || 1);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tab.replace(/'/g, "''")}'`
  });

  const rows = response.data.values || [];
  if (rows.length < 2) {
    await sourceRow.update({
      lastSyncedAt: new Date(),
      lastSyncStatus: 'ok',
      lastSyncError: null
    });
    return {
      imported: 0,
      skipped: 0,
      assigned: 0,
      uploadId: sourceRow.uploadId || '',
      message: 'No data rows'
    };
  }

  const headers = rows[0].map((h) => String(h));
  const dataRows = rows.slice(Math.max(1, startRow - 1));
  const leads: MappedSheetLead[] = [];
  let skipped = 0;

  for (let i = 0; i < dataRows.length; i += 1) {
    const mapped = rowToLeadObject(headers, dataRows[i], tab);
    if (!mapped) {
      skipped += 1;
      continue;
    }
    leads.push({ ...mapped, sheetRowIndex: startRow + i });
  }

  const upload = await createOrGetSheetUploadBatch(sourceRow);
  let imported = 0;

  for (const lead of leads) {
    if (lead.externalId) {
      const byExternal = await CallingLead.findOne({
        where: { sheetSourceId: sourceRow.id, externalId: lead.externalId }
      });
      if (byExternal) {
        skipped += 1;
        continue;
      }
    }

    const byMobile = await CallingLead.findOne({
      where: { mobileNormalized: lead.mobile }
    });
    if (byMobile) {
      skipped += 1;
      continue;
    }

    try {
      await CallingLead.create({
        id: uuidv4(),
        batchId: upload.id,
        sheetSourceId: sourceRow.id,
        externalId: lead.externalId,
        sheetRowIndex: lead.sheetRowIndex,
        name: lead.name,
        mobile: lead.mobile,
        mobileNormalized: lead.mobile,
        address: lead.address || null,
        city: lead.city,
        kNumber: lead.kw || null,
        customerNote: lead.customerNote || null,
        platform: lead.platform || null,
        campaignName: lead.campaignName || null,
        adName: lead.adName || null,
        sheetLeadStatus: lead.sheetLeadStatus || null,
        remarks: lead.remarks || null,
        remarks2: lead.remarks2 || null,
        assignedPersonName: lead.assignedPersonName || null,
        firstCallResponse: lead.firstCallResponse || null,
        secondCallResponse: lead.secondCallResponse || null,
        loginFlag: lead.loginFlag,
        finalDecision: lead.finalDecision || null,
        finalDecisionReason: lead.finalDecisionReason || null,
        sheetCreatedTime: lead.sheetCreatedTime,
        rawPayload: lead.raw
      });
      imported += 1;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        skipped += 1;
        continue;
      }
      throw error;
    }
  }

  const leadCount = await CallingLead.count({ where: { batchId: upload.id } });
  await upload.update({ rowCount: Math.max(upload.rowCount, leadCount) });

  await sourceRow.update({
    lastSyncedRow: rows.length,
    lastSyncedAt: new Date(),
    lastSyncStatus: 'ok',
    lastSyncError: null,
    uploadId: upload.id
  });

  let assigned = 0;
  const dealerIds = asDealerIdArray(sourceRow.dealerIds);
  if (assignLeads && sourceRow.enabled && dealerIds.length) {
    try {
      const assignResult = await assignUploadBatchWithActiveCap({
        batchId: upload.id,
        dealerIds,
        activeLimitPerDealer: sourceRow.activeLimitPerDealer || 1,
        assignedByUserId
      });
      assigned = assignResult.assigned;
    } catch (error) {
      logError('Sheet sync assign active_cap failed (non-fatal)', error, {
        sheetSourceId: sourceRow.id,
        uploadId: upload.id
      });
    }
  }

  emitRealtime(realtimeEvents.callingUploadsUpdated, {
    batchId: upload.id,
    sheetSourceId: sourceRow.id,
    source: 'google-sheet-sync',
    at: new Date().toISOString()
  });

  return { imported, skipped, assigned, uploadId: upload.id };
};
