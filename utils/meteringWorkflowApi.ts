/**
 * Metering sub-workflow vs installation pipeline (§V).
 * `installer_approved` is NOT `metering_approved` — UI must use `meteringStatus` for MCO/Approved tabs.
 */

const METERING_CANONICAL_STATUSES = new Set([
  'pending_metering',
  'metering_in_progress',
  'metering_approved',
  'mco'
]);

/** Derive metering tab stage from persisted installationStatus. */
export const deriveMeteringStatus = (
  installationStatus: string | null | undefined
): string | null => {
  const inst = String(installationStatus || '').trim();
  if (!inst) return null;
  if (METERING_CANONICAL_STATUSES.has(inst)) return inst;
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
}) => {
  const inst = q.installationStatus ?? null;
  const meteringStatus = deriveMeteringStatus(inst);
  const mcoStatus = inst === 'mco' ? 'mco' : null;

  return {
    installationStatus: inst,
    installation_status: inst,
    meteringStatus,
    metering_status: meteringStatus,
    meteringStage: meteringStatus,
    metering_stage: meteringStatus,
    mcoStatus,
    mco_status: mcoStatus,
    meteringApprovedAt: q.meteringApprovedAt ?? null,
    metering_approved_at: q.meteringApprovedAt ?? null,
    mcoAt: q.mcoAt ?? null,
    mco_at: q.mcoAt ?? null,
    completionAt: q.completionAt ?? null,
    completion_at: q.completionAt ?? null
  };
};
