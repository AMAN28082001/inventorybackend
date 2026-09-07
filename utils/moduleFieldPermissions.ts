import { Request, Response } from 'express';
import { AccountManager } from '../models';
import { Dealer, Visitor } from '../models/index-quotation';
import { AccessKey, canAccessSection, hasAdminPanelAccess } from './userAccess';

export const OFFICE_LOCATIONS = ['Jaipur', 'Ajmer', 'Chomu'] as const;
export type OfficeLocation = (typeof OFFICE_LOCATIONS)[number];

export type WorkflowModuleKey = 'accounts' | 'installation' | 'metering' | 'final_confirmation';
export type ModulePermissionLevel = 'none' | 'read' | 'write';
export type ModulePermissionScope = 'everyone' | 'selected_users' | 'office_only';

export type ModulePermissionRule = {
  level: ModulePermissionLevel;
  scope: ModulePermissionScope;
  selectedUserIds: string[];
};

export type ModuleFieldPermissions = Partial<Record<WorkflowModuleKey, ModulePermissionRule>>;

export const DEFAULT_MODULE_PERMISSION: ModulePermissionRule = {
  level: 'write',
  scope: 'everyone',
  selectedUserIds: []
};

/** Legacy DB/input → canonical scope (§AK: no dealer exclusion for everyone). */
export const normalizeScope = (raw: unknown): ModulePermissionScope => {
  const key = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (key === 'selected_users' || key === 'selected' || key === 'selected_person' || key === 'selected_persons') {
    return 'selected_users';
  }
  if (key === 'office_only' || key === 'office' || key === 'only_office' || key === 'only_there') {
    return 'office_only';
  }
  if (key === 'everyone' || key === 'all' || key === 'everyone_except_dealer') {
    return 'everyone';
  }
  return 'everyone';
};

const normalizeLevel = (raw: unknown): ModulePermissionLevel => {
  const key = String(raw || '')
    .trim()
    .toLowerCase();
  if (key === 'read' || key === 'readonly' || key === 'read_only') return 'read';
  if (key === 'write' || key === 'edit' || key === 'read_write') return 'write';
  return 'none';
};

export const normalizeOfficeLocation = (raw: unknown): OfficeLocation | null => {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  return (OFFICE_LOCATIONS as readonly string[]).includes(s) ? (s as OfficeLocation) : null;
};

export const normalizeModulePermissionRule = (raw: unknown): ModulePermissionRule => {
  if (!raw || typeof raw !== 'object') {
    return { level: 'none', scope: 'everyone', selectedUserIds: [] };
  }
  const o = raw as Record<string, unknown>;
  const selectedRaw = o.selectedUserIds ?? o.selected_user_ids ?? o.userIds ?? o.user_ids;
  const selectedUserIds = Array.isArray(selectedRaw)
    ? selectedRaw.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const scope = normalizeScope(o.scope);
  return {
    level: normalizeLevel(o.level ?? o.access ?? o.permission),
    scope,
    selectedUserIds: scope === 'selected_users' ? selectedUserIds : []
  };
};

export const normalizeModuleFieldPermissions = (raw: unknown): ModuleFieldPermissions => {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const out: ModuleFieldPermissions = {};
  if (o.accounts != null) out.accounts = normalizeModulePermissionRule(o.accounts);
  if (o.installation != null) out.installation = normalizeModulePermissionRule(o.installation);
  if (o.metering != null) out.metering = normalizeModulePermissionRule(o.metering);
  if (o.final_confirmation != null) out.final_confirmation = normalizeModulePermissionRule(o.final_confirmation);
  if (o.finalConfirmation != null) out.final_confirmation = normalizeModulePermissionRule(o.finalConfirmation);
  return out;
};

export const parseOfficeLocationFromBody = (body: Record<string, unknown>): OfficeLocation | null | undefined => {
  if (body.officeLocation === undefined && body.office_location === undefined) return undefined;
  const raw = body.officeLocation ?? body.office_location;
  if (raw === null || raw === '') return null;
  const normalized = normalizeOfficeLocation(raw);
  if (!normalized) {
    throw new Error('officeLocation must be Jaipur, Ajmer, Chomu, or null');
  }
  return normalized;
};

export const parseModuleFieldPermissionsFromBody = (
  body: Record<string, unknown>
): ModuleFieldPermissions | undefined => {
  const raw =
    body.moduleFieldPermissions ??
    body.modulePermissions ??
    body.module_permissions ??
    body.moduleFieldPermissionsJson;
  if (raw === undefined) return undefined;
  return normalizeModuleFieldPermissions(raw);
};

export const serializeModuleFieldPermissionsForApi = (
  raw: unknown
): ModuleFieldPermissions => normalizeModuleFieldPermissions(raw ?? {});

export const workflowPermissionFieldsForApi = (row: Record<string, unknown>) => {
  const officeLocation = normalizeOfficeLocation(row.officeLocation ?? row.office_location);
  const moduleFieldPermissions = serializeModuleFieldPermissionsForApi(
    row.moduleFieldPermissions ?? row.module_field_permissions ?? {}
  );
  return {
    officeLocation,
    office_location: officeLocation,
    moduleFieldPermissions,
    modulePermissions: moduleFieldPermissions,
    module_permissions: moduleFieldPermissions
  };
};

export const quotationOfficeLocationApiFields = (row: Record<string, unknown>) => {
  const officeLocation = normalizeOfficeLocation(row.officeLocation ?? row.office_location);
  return {
    officeLocation,
    office_location: officeLocation
  };
};

export type ModulePermissionContext = {
  userId?: string;
  username?: string;
  officeLocation?: OfficeLocation | null;
  recordOfficeLocation?: OfficeLocation | null;
  recordUserId?: string;
  viewerIsAdmin?: boolean;
};

export const getModulePermissionRule = (
  permissions: ModuleFieldPermissions | undefined,
  module: WorkflowModuleKey
): ModulePermissionRule => permissions?.[module] ?? { ...DEFAULT_MODULE_PERMISSION };

export const WORKFLOW_MODULE_ACCESS_KEYS: Array<{ module: WorkflowModuleKey; accessKey: AccessKey }> = [
  { module: 'accounts', accessKey: 'accounts' },
  { module: 'installation', accessKey: 'installation' },
  { module: 'metering', accessKey: 'metering' },
  { module: 'final_confirmation', accessKey: 'final_confirmation' }
];

const scopeAllows = (rule: ModulePermissionRule, ctx: ModulePermissionContext): boolean => {
  if (ctx.viewerIsAdmin) return true;
  const scope = normalizeScope(rule.scope);
  if (scope === 'everyone') return true;
  if (scope === 'office_only') return true;
  if (scope === 'selected_users') return rule.selectedUserIds.length > 0;
  return true;
};

const recordScopeAllows = (rule: ModulePermissionRule, ctx: ModulePermissionContext): boolean => {
  if (ctx.viewerIsAdmin) return true;
  const scope = normalizeScope(rule.scope);
  if (scope === 'everyone') return true;
  if (scope === 'selected_users') {
    if (!rule.selectedUserIds.length) return false;
    const recordUserId = String(ctx.recordUserId || '').trim();
    return Boolean(recordUserId && rule.selectedUserIds.includes(recordUserId));
  }
  if (scope === 'office_only') {
    const recordUserId = String(ctx.recordUserId || '').trim();
    const viewerId = String(ctx.userId || '').trim();
    if (ctx.officeLocation && ctx.recordOfficeLocation) {
      return ctx.officeLocation === ctx.recordOfficeLocation;
    }
    return Boolean(viewerId && recordUserId && recordUserId === viewerId);
  }
  return true;
};

export const recordMatchesWorkflowScope = (
  permissions: ModuleFieldPermissions | undefined,
  module: WorkflowModuleKey,
  ctx: ModulePermissionContext
): boolean => {
  if (ctx.viewerIsAdmin) return true;
  const rule = getModulePermissionRule(permissions, module);
  if (rule.level === 'none') return false;
  if (!scopeAllows(rule, ctx)) return false;
  return recordScopeAllows(rule, ctx);
};

export const canViewWorkflowRecord = (
  permissions: ModuleFieldPermissions | undefined,
  module: WorkflowModuleKey,
  ctx: ModulePermissionContext
): boolean => recordMatchesWorkflowScope(permissions, module, ctx);

/** Everyone scope (or admin) → fetch full admin quotation list (all dealers). */
export const canAccessFullAdminQuotationList = (
  permissions: ModuleFieldPermissions | undefined,
  user: { role?: string | null; access?: unknown; username?: string | null; viewerIsAdmin?: boolean }
): boolean => {
  if (user.viewerIsAdmin) return true;
  for (const { module, accessKey } of WORKFLOW_MODULE_ACCESS_KEYS) {
    if (
      !canAccessSection(
        { role: user.role, access: user.access, username: user.username },
        accessKey
      )
    ) {
      continue;
    }
    const rule = getModulePermissionRule(permissions, module);
    if (rule.level === 'none') continue;
    if (normalizeScope(rule.scope) === 'everyone') return true;
  }
  return false;
};

export const resolveWorkflowModuleForInstallationStatus = (
  status: string | null | undefined
): WorkflowModuleKey | null => {
  const key = String(status || '').trim().toLowerCase();
  if (!key) return null;
  if (
    [
      'pending_installer',
      'installer_in_progress',
      'installer_partial_approved',
      'installer_approved',
      'installer_rejected'
    ].includes(key)
  ) {
    return 'installation';
  }
  if (
    [
      'pending_metering',
      'metering_in_progress',
      'metering_approved',
      'meter_installation_pending',
      'mco'
    ].includes(key)
  ) {
    return 'metering';
  }
  if (['pending_baldev', 'baldev_approved', 'baldev_rejected', 'completed'].includes(key)) {
    return 'final_confirmation';
  }
  return null;
};

export const canWriteWorkflowModule = (
  permissions: ModuleFieldPermissions | undefined,
  module: WorkflowModuleKey,
  ctx: ModulePermissionContext
): boolean => {
  if (ctx.viewerIsAdmin) return true;
  const rule = getModulePermissionRule(permissions, module);
  if (rule.level !== 'write') return false;
  if (!scopeAllows(rule, ctx)) return false;
  return recordScopeAllows(rule, ctx);
};

export const quotationRecordPermissionContext = (quotation: {
  dealerId?: string | null;
  officeLocation?: string | null;
  office_location?: string | null;
}): Pick<ModulePermissionContext, 'recordOfficeLocation' | 'recordUserId'> => ({
  recordOfficeLocation: normalizeOfficeLocation(
    quotation.officeLocation ?? quotation.office_location
  ),
  recordUserId: String(quotation.dealerId || '').trim() || undefined
});

const isViewerAdmin = (req: Request): boolean => {
  if (req.dealer?.role === 'admin') return true;
  if (hasAdminPanelAccess(req)) return true;
  const role = String(req.user?.role || '').toLowerCase();
  return role === 'admin' || role === 'super-admin' || role === 'super-admin-manager';
};

export const buildWorkflowPermissionContext = async (
  req: Request
): Promise<ModulePermissionContext & { moduleFieldPermissions: ModuleFieldPermissions }> => {
  const userId = req.user?.id || req.dealer?.id || req.visitor?.id || '';
  const username = req.user?.username || req.dealer?.username || req.visitor?.username || '';
  const viewerIsAdmin = isViewerAdmin(req);

  let officeLocation: OfficeLocation | null = null;
  let moduleFieldPermissions: ModuleFieldPermissions = {};

  if (req.dealer?.id) {
    const dealer = await Dealer.findByPk(req.dealer.id, {
      attributes: ['officeLocation', 'moduleFieldPermissions', 'role']
    });
    if (dealer) {
      officeLocation = normalizeOfficeLocation((dealer as any).officeLocation);
      moduleFieldPermissions = serializeModuleFieldPermissionsForApi(
        (dealer as any).moduleFieldPermissions
      );
    }
  } else if (req.visitor?.id) {
    const visitor = await Visitor.findByPk(req.visitor.id, {
      attributes: ['officeLocation', 'moduleFieldPermissions']
    });
    if (visitor) {
      officeLocation = normalizeOfficeLocation((visitor as any).officeLocation);
      moduleFieldPermissions = serializeModuleFieldPermissionsForApi(
        (visitor as any).moduleFieldPermissions
      );
    }
  } else if (req.user?.id) {
    const am = await AccountManager.findByPk(req.user.id, {
      attributes: ['officeLocation', 'moduleFieldPermissions']
    });
    if (am) {
      officeLocation = normalizeOfficeLocation((am as any).officeLocation);
      moduleFieldPermissions = serializeModuleFieldPermissionsForApi(
        (am as any).moduleFieldPermissions
      );
    }
  }

  return {
    userId,
    username,
    officeLocation,
    viewerIsAdmin,
    moduleFieldPermissions
  };
};

/** Returns false and sends 403 when write is denied. */
export const enforceWorkflowFieldWriteOrRespond = async (
  req: Request,
  res: Response,
  module: WorkflowModuleKey,
  quotation: { dealerId?: string | null; officeLocation?: string | null; office_location?: string | null }
): Promise<boolean> => {
  const baseCtx = await buildWorkflowPermissionContext(req);
  const recordCtx = quotationRecordPermissionContext(quotation);
  const ctx: ModulePermissionContext = {
    userId: baseCtx.userId,
    username: baseCtx.username,
    officeLocation: baseCtx.officeLocation,
    viewerIsAdmin: baseCtx.viewerIsAdmin,
    ...recordCtx
  };

  if (canWriteWorkflowModule(baseCtx.moduleFieldPermissions, module, ctx)) {
    return true;
  }

  res.status(403).json({
    success: false,
    error: {
      code: 'FIELD_PERMISSION_DENIED',
      message: `Write access denied for ${module.replace('_', ' ')} on this quotation`
    }
  });
  return false;
};
