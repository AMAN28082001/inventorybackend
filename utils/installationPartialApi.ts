/**
 * Admin Installation — Partial Approved (`installer_partial_approved`) API fields.
 * See BACKEND_INSTALLATION_PARTIAL_AND_METERING.md.
 */

export const INSTALLATION_PARTIAL_STATUS = 'installer_partial_approved' as const;

export const isInstallationPartialApprovedStatus = (
  installationStatus: string | null | undefined
): boolean => {
  const s = String(installationStatus || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  return s === INSTALLATION_PARTIAL_STATUS || s === 'partial_approved';
};

/** Truthy multipart / JSON flag helpers (`"true"` / true / 1). */
export const parseTruthyFlag = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const s = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(s)) return true;
  if (['false', '0', 'no'].includes(s)) return false;
  return undefined;
};

export const installationPartialApiFields = (q: {
  installationStatus?: string | null;
  installationPartialApproved?: boolean | null;
  installationPartialApprovedAt?: Date | string | null;
}) => {
  const statusPartial = isInstallationPartialApprovedStatus(q.installationStatus);
  const flagPartial = Boolean(q.installationPartialApproved) || statusPartial;
  return {
    installationPartialApproved: flagPartial,
    installation_partial_approved: flagPartial,
    installationPartialApprovedAt: q.installationPartialApprovedAt ?? null,
    installation_partial_approved_at: q.installationPartialApprovedAt ?? null
  };
};

/** Metering details card — remarks + authorized representative + discom (+ snake_case). */
export const meteringDetailsEchoFields = (q: {
  meteringRemarks?: string | null;
  meteringAuthorizedRepresentative?: string | null;
  discomName?: string | null;
  discomLocation?: string | null;
}) => {
  const remarks = q.meteringRemarks ?? null;
  const authorized = q.meteringAuthorizedRepresentative ?? null;
  const location = q.discomLocation ?? null;
  return {
    discomName: q.discomName ?? null,
    discom_name: q.discomName ?? null,
    discomLocation: location,
    discom_location: location,
    remarks,
    meteringRemarks: remarks,
    metering_remarks: remarks,
    authorizedRepresentative: authorized,
    authorized_representative: authorized,
    assignedPersonName: authorized,
    assigned_person_name: authorized,
    meteringAuthorizedRepresentative: authorized,
    metering_authorized_representative: authorized
  };
};
