import { Quotation } from '../models/index-quotation';
import { normalizeInstallStatus } from './installationRevert';
import { normalizeMeteringWorkflowStatus } from './meteringWorkflowApi';

const EARLY_METERING = new Set(['pending_metering', 'metering_in_progress', '']);

const LATE_METERING = new Set([
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

export class RetrieveFromMeteringError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 409, code = 'WF_RETRIEVE_METERING_001') {
    super(message);
    this.name = 'RetrieveFromMeteringError';
    this.status = status;
    this.code = code;
  }
}

const currentStages = (quotation: {
  installationStatus?: string | null;
  installation_status?: string | null;
}) => {
  const install = normalizeInstallStatus(
    quotation.installationStatus ?? quotation.installation_status
  );
  return { install, metering: install };
};

/** Meter Pending → installer_approved; keep Payment Management release flags. */
export const buildRetrieveFromMeteringPatch = (quotation: {
  installationStatus?: string | null;
  installation_status?: string | null;
}): Record<string, unknown> => {
  const { install } = currentStages(quotation);

  const inEarly =
    EARLY_METERING.has(install) ||
    install === 'pending_metering' ||
    install === 'metering_in_progress';

  if (!inEarly) {
    throw new RetrieveFromMeteringError(
      `Cannot retrieve from metering while stage is '${install || 'unset'}'. Use late-stage revert flows.`
    );
  }

  if (LATE_METERING.has(install)) {
    throw new RetrieveFromMeteringError(
      'Quotation is past Meter Pending — retrieve not allowed.',
      409,
      'WF_RETRIEVE_METERING_002'
    );
  }

  return {
    installationStatus: 'installer_approved',
    meteringApprovedAt: null,
    mcoAt: null,
    meterInstallationPendingAt: null,
    meteringWccAfterDiscom: false,
    meteringWccAfterDiscomAt: null,
    meteringActionAt: null
  };
};

export const applyRetrieveFromMetering = async (quotation: Quotation): Promise<Quotation> => {
  const patch = buildRetrieveFromMeteringPatch(quotation as any);
  await quotation.update(patch as any);
  await quotation.reload();
  return quotation;
};

export const isRetrieveFromMeteringRequest = (body: Record<string, unknown> | null | undefined): boolean => {
  if (!body) return false;
  const truthy = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1';
  if (truthy(body.retrieveFromMetering)) return true;
  const target = normalizeMeteringWorkflowStatus(String(body.target || ''));
  if (target === 'installer_approved' && truthy(body.allowRevert)) return true;
  return false;
};
