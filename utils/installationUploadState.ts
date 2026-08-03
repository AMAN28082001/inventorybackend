/**
 * Installation completion upload state gate — Aug 2026 (§29).
 * See BACKEND_INSTALLATION_UPLOAD_STATE.ts
 *
 * Allow Complete / Partial from pending_installer without requiring Start first.
 */

/** Statuses that may upload completion / partial docs. */
export const INSTALLATION_UPLOAD_ALLOWED_FROM = new Set([
  '',
  'pending_installer',
  'pending',
  'released',
  'sent_to_installer',
  'installer_in_progress',
  'in_progress',
  'installer_partial_approved',
  // Re-upload / edit after full approve (admin edit photos)
  'installer_approved'
]);

/** Statuses that must never accept a new completion upload (unless force). */
export const INSTALLATION_UPLOAD_BLOCKED = new Set([
  'installer_rejected',
  'pending_metering',
  'metering_in_progress',
  'metering_approved',
  'meter_installation_pending',
  'mco',
  'pending_baldev',
  'baldev_approved',
  'completed'
]);

export function normalizeInstallStatus(raw: unknown): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function isInstallationUploadForce(
  body: Record<string, unknown> | null | undefined,
  role?: string | null
): boolean {
  const r = String(role || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (
    r === 'admin' ||
    r === 'superadmin' ||
    r === 'super_admin' ||
    r === 'super_admin_manager'
  ) {
    return true;
  }
  if (!body) return false;
  if (body.force === true || body.force === 'true' || body.force === 1) return true;
  if (body.adminOverride === true || body.adminOverride === 'true') return true;
  if (body.allowFromPendingInstaller === true || body.allowFromPendingInstaller === 'true') {
    return true;
  }
  return false;
}

export type InstallationUploadGateResult =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

/**
 * Call at the start of completion-documents handlers (after auth + load quotation).
 */
export function assertInstallationUploadAllowed(args: {
  quotation: { installationStatus?: string | null; installation_status?: string | null } | null | undefined;
  role?: string | null;
  body?: Record<string, unknown> | null;
}): InstallationUploadGateResult {
  const current = normalizeInstallStatus(
    args.quotation?.installationStatus ?? args.quotation?.installation_status
  );
  const force = isInstallationUploadForce(args.body, args.role);

  if (INSTALLATION_UPLOAD_BLOCKED.has(current) && !force) {
    return {
      ok: false,
      status: 409,
      code: 'WF_INSTALL_001',
      message: 'Installation upload not allowed for this quotation state'
    };
  }

  // Allow pending_installer (and empty) for admin and installer —
  // completing from Pending without a separate Start is product intent.
  if (!current || INSTALLATION_UPLOAD_ALLOWED_FROM.has(current)) {
    return { ok: true };
  }

  if (force) {
    return { ok: true };
  }

  return {
    ok: false,
    status: 409,
    code: 'WF_INSTALL_001',
    message: 'Installation upload not allowed for this quotation state'
  };
}

/** Resolve completion target status from multipart body. */
export function resolveInstallationUploadTargetStatus(
  body: Record<string, unknown> | null | undefined
): 'installer_approved' | 'installer_partial_approved' | null {
  const targetRaw = String(body?.installationStatus ?? body?.installation_status ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (targetRaw === 'installer_partial_approved') return 'installer_partial_approved';
  if (targetRaw === 'installer_approved') return 'installer_approved';
  const partial =
    body?.installationPartialApproved === true ||
    body?.installationPartialApproved === 'true' ||
    body?.installation_partial_approved === true ||
    body?.installation_partial_approved === 'true';
  if (partial) return 'installer_partial_approved';
  return null;
}
