/**
 * Admin Installation Revert — installer_approved / partial → pending_installer.
 * See BACKEND_INSTALLATION_REVERT.ts, REQUIRED §AH.
 *
 * Never write pending_installer onto quotations.status (that enum is pending|approved|rejected).
 * Never delete S3 photos.
 */

export const INSTALLATION_REVERT_ALLOWED_FROM = new Set([
  'installer_approved',
  'installer_partial_approved',
  'partial_approved',
  'installer_in_progress',
  'in_progress',
  'pending_installer'
]);

export const normalizeInstallStatus = (raw: unknown): string =>
  String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

export const isPendingInstallerStatus = (raw: unknown): boolean =>
  normalizeInstallStatus(raw) === 'pending_installer';

export const isAdminInstallationRevertRequest = (
  body: Record<string, unknown> | null | undefined,
  nextStatus: string
): boolean => {
  if (!isPendingInstallerStatus(nextStatus)) return false;
  if (!body) return true;
  const source = String(body.source || '').toLowerCase();
  if (source.includes('revert') || source === 'admin-install-revert') return true;
  const truthy = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1';
  if (truthy(body.allowRevert) || truthy(body.force) || truthy(body.adminOverride)) return true;
  // Admin PATCH to pending_installer is always a revert (handler is admin-only).
  return true;
};

export const installationRevertPatch = (): Record<string, unknown> => ({
  installationStatus: 'pending_installer',
  installerApprovedAt: null,
  installationPartialApproved: false,
  installationPartialApprovedAt: null
});

export const installationRevertApiFields = (quotationStatus: string | null | undefined) => ({
  status: quotationStatus || null,
  installationStatus: 'pending_installer' as const,
  installation_status: 'pending_installer' as const,
  installerApprovedAt: null,
  installer_approved_at: null,
  installationPartialApproved: false,
  installation_partial_approved: false,
  installationPartialApprovedAt: null,
  installation_partial_approved_at: null
});
