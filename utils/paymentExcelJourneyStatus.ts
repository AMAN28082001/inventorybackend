import { deriveMeteringStatus } from './meteringWorkflowApi';

export type JourneyStageState = 'pending' | 'in_progress' | 'completed' | 'rejected' | 'not_started';

export type JourneyStageProgress = {
  adminApproval: JourneyStageState;
  installation: JourneyStageState;
  metering: JourneyStageState;
  finalConfirmation: JourneyStageState;
};

const INSTALLATION_STATUS_LABELS: Record<string, string> = {
  pending_installer: 'Pending Installer',
  installer_in_progress: 'Installer In Progress',
  installer_partial_approved: 'Installer Partial Approved',
  installer_approved: 'Installer Approved',
  installer_rejected: 'Installer Rejected',
  pending_baldev: 'Pending Final Confirmation',
  baldev_approved: 'Final Confirmation Approved',
  baldev_rejected: 'Final Confirmation Rejected',
  pending_metering: 'Pending Metering',
  metering_in_progress: 'Metering In Progress',
  metering_approved: 'Meter in Discom',
  meter_installation_pending: 'Meter Installation Pending',
  mco: 'Final Step',
  completed: 'Completed'
};

/** FILE STATUS → Metering labels (Pending | In Progress | Completed). */
const METERING_FILE_STATUS_LABELS: Record<JourneyStageState, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  rejected: 'Rejected',
  not_started: 'Pending'
};

const ADMIN_APPROVAL_LABELS: Record<string, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  pending: 'Pending',
  draft: 'Draft'
};

const FINAL_CONFIRMATION_LABELS: Record<string, string> = {
  pending_baldev: 'Pending',
  baldev_approved: 'Approved',
  baldev_rejected: 'Rejected'
};

const toStageState = (value: JourneyStageState): JourneyStageState => value;

const readTruthyFlag = (v: unknown): boolean =>
  v === true || v === 1 || v === 'true' || v === '1';

export const deriveAdminApprovalStage = (status: string | null | undefined): JourneyStageState => {
  const s = String(status || 'pending').trim().toLowerCase();
  if (s === 'approved') return 'completed';
  if (s === 'rejected') return 'rejected';
  return 'pending';
};

export const deriveInstallationStage = (
  quotationStatus: string | null | undefined,
  installationStatus: string | null | undefined
): JourneyStageState => {
  if (deriveAdminApprovalStage(quotationStatus) !== 'completed') return 'not_started';
  const inst = String(installationStatus || 'pending_installer').trim();
  if (inst === 'installer_rejected') return 'rejected';
  if (
    [
      'metering_approved',
      'mco',
      'completed',
      'pending_metering',
      'metering_in_progress',
      'meter_installation_pending',
      'baldev_approved'
    ].includes(inst)
  ) {
    return 'completed';
  }
  if (['installer_approved', 'pending_baldev', 'baldev_rejected'].includes(inst)) return 'completed';
  if (inst === 'installer_in_progress' || inst === 'installer_partial_approved') return 'in_progress';
  return 'pending';
};

/**
 * Metering FILE STATUS (§24) — align Admin → Metering tabs.
 * Matches frontend `resolveMeteringJourneyStatus` / BACKEND_PAYMENT_EXCEL_JOURNEY_STATUS.ts
 *
 * | Tab                         | Persist                        | Label        |
 * |-----------------------------|--------------------------------|--------------|
 * | Meter Pending               | pending_metering               | Pending      |
 * | Meter in Discom             | metering_approved              | In Progress  |
 * | WCC Pending                 | meteringWccAfterDiscom: true   | In Progress  |
 * | Meter Installation Pending  | meter_installation_pending     | In Progress  |
 * | Final Step                  | mco                            | Completed    |
 */
export const deriveMeteringStage = (
  quotationStatus: string | null | undefined,
  installationStatus: string | null | undefined,
  meteringWccAfterDiscom?: unknown
): JourneyStageState => {
  if (deriveAdminApprovalStage(quotationStatus) !== 'completed') return 'not_started';

  const inst = String(installationStatus || '')
    .trim()
    .toLowerCase();
  const metering = String(deriveMeteringStatus(installationStatus) || inst || '')
    .trim()
    .toLowerCase();

  // After Final Step (Baldev+) or Final Step (mco) → Completed
  if (
    ['pending_baldev', 'baldev_approved', 'completed'].includes(inst) ||
    ['pending_baldev', 'baldev_approved', 'completed', 'mco'].includes(metering) ||
    metering.includes('mco')
  ) {
    return 'completed';
  }

  // WCC / Discom / Meter Installation → In Progress
  if (readTruthyFlag(meteringWccAfterDiscom)) return 'in_progress';
  if (
    [
      'metering_approved',
      'metering_in_progress',
      'meter_installation_pending',
      'meter_install_pending'
    ].includes(metering) ||
    metering.includes('meter_install')
  ) {
    return 'in_progress';
  }

  // Meter Pending (or not yet in metering pipeline) → Pending
  if (metering === 'pending_metering') return 'pending';
  return 'pending';
};

export const deriveFinalConfirmationStage = (
  quotationStatus: string | null | undefined,
  installationStatus: string | null | undefined
): JourneyStageState => {
  if (deriveAdminApprovalStage(quotationStatus) !== 'completed') return 'not_started';
  const inst = String(installationStatus || '').trim();
  if (inst === 'baldev_rejected') return 'rejected';
  if (
    inst === 'baldev_approved' ||
    ['pending_metering', 'metering_in_progress', 'metering_approved', 'meter_installation_pending', 'mco', 'completed'].includes(
      inst
    )
  ) {
    return 'completed';
  }
  if (inst === 'pending_baldev') return 'in_progress';
  return 'not_started';
};

export const buildJourneyStageProgress = (input: {
  status?: string | null;
  installationStatus?: string | null;
  meteringWccAfterDiscom?: unknown;
}): JourneyStageProgress => ({
  adminApproval: toStageState(deriveAdminApprovalStage(input.status)),
  installation: toStageState(deriveInstallationStage(input.status, input.installationStatus)),
  metering: toStageState(
    deriveMeteringStage(input.status, input.installationStatus, input.meteringWccAfterDiscom)
  ),
  finalConfirmation: toStageState(
    deriveFinalConfirmationStage(input.status, input.installationStatus)
  )
});

/** Last Excel column — mirrors frontend `lib/customer-journey.ts` file status label. */
export const deriveFileStatusLabel = (input: {
  status?: string | null;
  installationStatus?: string | null;
  installationReadyForInstaller?: boolean;
  fileLoginStatus?: string | null;
  meteringWccAfterDiscom?: unknown;
}): string => {
  const quotationStatus = String(input.status || 'pending').trim().toLowerCase();
  if (quotationStatus !== 'approved') return 'Workflow Pending';

  const inst = String(input.installationStatus || '').trim();
  if (!inst || inst === 'pending_installer') {
    return input.installationReadyForInstaller ? 'Pending Installation' : 'Workflow Pending';
  }
  if (inst === 'installer_in_progress') return 'Installation In Progress';
  if (inst === 'installer_rejected') return 'Installation Rejected';
  if (inst === 'installer_approved' || inst === 'pending_baldev') return 'Pending Final Confirmation';
  if (inst === 'baldev_rejected') return 'Final Confirmation Rejected';
  if (inst === 'baldev_approved' || inst === 'pending_metering') return 'Pending Metering';
  if (inst === 'metering_in_progress') return 'Metering In Progress';
  if (inst === 'metering_approved') {
    if (readTruthyFlag(input.meteringWccAfterDiscom)) return 'WCC Pending';
    return input.fileLoginStatus === 'already_login' ? 'File Logged In' : 'Meter in Discom';
  }
  if (inst === 'meter_installation_pending' || inst === 'meter_install_pending') {
    return 'Meter Installation Pending';
  }
  if (inst === 'mco') return 'Final Step';
  if (inst === 'completed') return 'Completed';
  return 'Workflow Pending';
};

export const paymentExcelJourneyApiFields = (q: Record<string, unknown>) => {
  const status = (q.status ?? null) as string | null;
  const installationStatus = (q.installationStatus ?? q.installation_status ?? null) as string | null;
  const installationReadyForInstaller = Boolean(
    q.installationReadyForInstaller ?? q.installation_ready_for_installer ?? false
  );
  const fileLoginStatus = (q.fileLoginStatus ?? q.file_login_status ?? null) as string | null;
  const meteringWccAfterDiscom =
    q.meteringWccAfterDiscom ?? q.metering_wcc_after_discom ?? false;
  const journeyStageProgress = buildJourneyStageProgress({
    status,
    installationStatus,
    meteringWccAfterDiscom
  });
  const fileStatus = deriveFileStatusLabel({
    status,
    installationStatus,
    installationReadyForInstaller,
    fileLoginStatus,
    meteringWccAfterDiscom
  });

  const instKey = String(installationStatus || 'pending_installer');
  const adminApprovalStatus =
    ADMIN_APPROVAL_LABELS[String(status || 'pending').toLowerCase()] || String(status || 'Pending');
  const installationStatusLabel = INSTALLATION_STATUS_LABELS[instKey] || instKey.replace(/_/g, ' ');
  const meteringStatusLabel = METERING_FILE_STATUS_LABELS[journeyStageProgress.metering] || 'Pending';
  const finalConfirmationStatusLabel =
    FINAL_CONFIRMATION_LABELS[instKey] ||
    ([
      'baldev_approved',
      'pending_metering',
      'metering_in_progress',
      'metering_approved',
      'meter_installation_pending',
      'mco',
      'completed'
    ].includes(instKey)
      ? 'Approved'
      : 'Not Started');

  return {
    journeyStageProgress,
    journey_stage_progress: journeyStageProgress,
    fileStatus,
    file_status: fileStatus,
    adminApprovalStatus,
    admin_approval_status: adminApprovalStatus,
    installationStatusLabel,
    installation_status_label: installationStatusLabel,
    meteringStatusLabel,
    metering_status_label: meteringStatusLabel,
    /** Explicit FILE STATUS → Metering (same as meteringStatusLabel). */
    meteringFileStatus: meteringStatusLabel,
    metering_file_status: meteringStatusLabel,
    finalConfirmationStatusLabel,
    final_confirmation_status_label: finalConfirmationStatusLabel
  };
};
