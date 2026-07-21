/**
 * Metering sub-workflow vs installation pipeline (§V).
 * `installer_approved` is NOT `metering_approved` — UI must use `meteringStatus` for MCO/Approved tabs.
 * See BACKEND_METER_INSTALLATION_PENDING.md for `meter_installation_pending`.
 */

export const METER_INSTALLATION_PENDING_STATUS = 'meter_installation_pending' as const;

const METERING_CANONICAL_STATUSES = new Set([
  'pending_metering',
  'metering_in_progress',
  'metering_approved',
  METER_INSTALLATION_PENDING_STATUS,
  'meter_install_pending', // read alias
  'mco'
]);

/** Normalize frontend alias `meter_install_pending` → canonical status. */
export const normalizeMeteringWorkflowStatus = (
  raw: string | null | undefined
): string | null => {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (!s) return null;
  if (s === 'meter_install_pending') return METER_INSTALLATION_PENDING_STATUS;
  return s;
};

/** Derive metering tab stage from persisted installationStatus. */
export const deriveMeteringStatus = (
  installationStatus: string | null | undefined
): string | null => {
  const inst = normalizeMeteringWorkflowStatus(installationStatus);
  if (!inst) return null;
  if (inst === 'meter_install_pending') return METER_INSTALLATION_PENDING_STATUS;
  if (METERING_CANONICAL_STATUSES.has(inst)) {
    return inst === 'meter_install_pending' ? METER_INSTALLATION_PENDING_STATUS : inst;
  }
  return null;
};

export const isMeteringApprovedInstallationStatus = (
  installationStatus: string | null | undefined
): boolean => String(installationStatus || '').trim() === 'metering_approved';

export const meteringWorkflowApiFields = (q: {
  installationStatus?: string | null;
  meteringApprovedAt?: Date | string | null;
  mcoAt?: Date | string | null;
  completionAt?: Date | string | null;
  meterInstallationPendingAt?: Date | string | null;
  meteringWccAfterDiscom?: boolean | null;
  meteringWccAfterDiscomAt?: Date | string | null;
}) => {
  const rawInst = q.installationStatus ?? null;
  const normalized = normalizeMeteringWorkflowStatus(rawInst) || rawInst;
  const meteringStatus = deriveMeteringStatus(rawInst);
  const mcoStatus = normalized === 'mco' ? 'mco' : null;
  const wccAfterDiscom = Boolean(q.meteringWccAfterDiscom);

  return {
    installationStatus: normalized,
    installation_status: normalized,
    meteringStatus,
    metering_status: meteringStatus,
    meteringStage: meteringStatus,
    metering_stage: meteringStatus,
    mcoStatus,
    mco_status: mcoStatus,
    meteringApprovedAt: q.meteringApprovedAt ?? null,
    metering_approved_at: q.meteringApprovedAt ?? null,
    meterInstallationPendingAt: q.meterInstallationPendingAt ?? null,
    meter_installation_pending_at: q.meterInstallationPendingAt ?? null,
    meteringWccAfterDiscom: wccAfterDiscom,
    metering_wcc_after_discom: wccAfterDiscom,
    meteringWccAfterDiscomAt: q.meteringWccAfterDiscomAt ?? null,
    metering_wcc_after_discom_at: q.meteringWccAfterDiscomAt ?? null,
    mcoAt: q.mcoAt ?? null,
    mco_at: q.mcoAt ?? null,
    completionAt: q.completionAt ?? null,
    completion_at: q.completionAt ?? null
  };
};

/** Parse post-Discom WCC flag from request body (camel / snake). */
export const parseMeteringWccAfterDiscomFlag = (
  body: Record<string, unknown> | null | undefined
): boolean | undefined => {
  if (!body) return undefined;
  const raw = body.meteringWccAfterDiscom ?? body.metering_wcc_after_discom;
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true;
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
  return undefined;
};
