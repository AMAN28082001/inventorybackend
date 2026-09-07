import { Quotation } from '../models/index-quotation';
import { normalizeInstallStatus } from './installationRevert';
import { deriveMeteringStatus } from './meteringWorkflowApi';

const LATE_BLOCK_RETRIEVE = new Set([
  'metering_approved',
  'meter_installation_pending',
  'meter_install',
  'meter_install_pending',
  'mco',
  'pending_baldev',
  'baldev_approved',
  'baldev_rejected',
  'completed'
]);

export class RetrieveFromInstallationError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 409, code = 'WF_RETRIEVE_INSTALL_001') {
    super(message);
    this.name = 'RetrieveFromInstallationError';
    this.status = status;
    this.code = code;
  }
};

export const isQuotationReleasedToInstaller = (quotation: {
  installationReadyForInstaller?: boolean | null;
  installation_ready_for_installer?: boolean | null;
  installationReleasedAt?: Date | string | null;
  installation_released_at?: Date | string | null;
}): boolean =>
  Boolean(
    quotation.installationReadyForInstaller ||
      quotation.installation_ready_for_installer ||
      quotation.installationReleasedAt ||
      quotation.installation_released_at
  );

/** Undo Send to Installer — clear release flags; do not touch installments or photos. */
export const buildRetrieveFromInstallationPatch = (
  quotation: {
    installationStatus?: string | null;
    installation_status?: string | null;
    installationReadyForInstaller?: boolean | null;
    installation_ready_for_installer?: boolean | null;
    installationReleasedAt?: Date | string | null;
    installation_released_at?: Date | string | null;
  },
  { force = false }: { force?: boolean } = {}
): Record<string, unknown> => {
  if (!isQuotationReleasedToInstaller(quotation) && !force) {
    throw new RetrieveFromInstallationError('Quotation was not released to installer.');
  }

  const install = normalizeInstallStatus(
    quotation.installationStatus ?? quotation.installation_status
  );
  const metering = deriveMeteringStatus(install) || install;

  if (LATE_BLOCK_RETRIEVE.has(metering) || LATE_BLOCK_RETRIEVE.has(install)) {
    throw new RetrieveFromInstallationError(
      'Cannot retrieve from Installation — quotation is already in Metering (approved or later).',
      409,
      'WF_RETRIEVE_INSTALL_002'
    );
  }

  const patch: Record<string, unknown> = {
    installationReadyForInstaller: false,
    installationReleasedAt: null
  };

  // installation_status is NOT NULL in DB — leave workflow as-is; queues gate on release flags.
  return patch;
};

export const applyRetrieveFromInstallation = async (
  quotation: Quotation,
  options: { force?: boolean } = {}
): Promise<Quotation> => {
  const patch = buildRetrieveFromInstallationPatch(quotation as any, options);
  await quotation.update(patch as any);
  await quotation.reload();
  return quotation;
};

export const isRetrieveFromInstallationRequest = (
  body: Record<string, unknown> | null | undefined
): boolean => {
  if (!body) return false;
  const truthy = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1';
  if (truthy(body.retrieveFromInstallation)) return true;
  const ready =
    body.installationReadyForInstaller ?? body.installation_ready_for_installer;
  if (ready === false || ready === 'false' || ready === 0 || ready === '0') {
    if (truthy(body.allowRevert) || truthy(body.force) || truthy(body.adminOverride)) {
      return true;
    }
    const source = String(body.source || '').toLowerCase();
    if (source.includes('retrieve-from-installation')) return true;
  }
  return false;
};
