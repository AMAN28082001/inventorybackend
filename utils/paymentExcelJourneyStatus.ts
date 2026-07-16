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
  metering_approved: 'Metering Approved',
  meter_installation_pending: 'Meter Installation Pending',
  mco: 'MCO',
  completed: 'Completed'
};

const METERING_STATUS_LABELS: Record<string, string> = {
  pending_metering: 'Pending',
  metering_in_progress: 'In Progress',
  metering_approved: 'Approved',
  mco: 'MCO'
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
  if (['metering_approved', 'mco', 'completed', 'pending_metering', 'metering_in_progress', 'meter_installation_pending', 'baldev_approved'].includes(inst)) {
    return 'completed';
  }
  if (['installer_approved', 'pending_baldev', 'baldev_rejected'].includes(inst)) return 'completed';
  if (inst === 'installer_in_progress' || inst === 'installer_partial_approved') return 'in_progress';
  return 'pending';
};

export const deriveMeteringStage = (
  quotationStatus: string | null | undefined,
  installationStatus: string | null | undefined
): JourneyStageState => {
  if (deriveAdminApprovalStage(quotationStatus) !== 'completed') return 'not_started';
  const metering = deriveMeteringStatus(installationStatus);
  if (!metering) return 'not_started';
  if (metering === 'metering_approved' || metering === 'mco') return 'completed';
  if (metering === 'metering_in_progress') return 'in_progress';
  return 'pending';
};

export const deriveFinalConfirmationStage = (
  quotationStatus: string | null | undefined,
  installationStatus: string | null | undefined
): JourneyStageState => {
  if (deriveAdminApprovalStage(quotationStatus) !== 'completed') return 'not_started';
  const inst = String(installationStatus || '').trim();
  if (inst === 'baldev_rejected') return 'rejected';
  if (inst === 'baldev_approved' || ['pending_metering', 'metering_in_progress', 'metering_approved', 'mco', 'completed'].includes(inst)) {
    return 'completed';
  }
  if (inst === 'pending_baldev') return 'in_progress';
  return 'not_started';
};

export const buildJourneyStageProgress = (input: {
  status?: string | null;
  installationStatus?: string | null;
}): JourneyStageProgress => ({
  adminApproval: toStageState(deriveAdminApprovalStage(input.status)),
  installation: toStageState(deriveInstallationStage(input.status, input.installationStatus)),
  metering: toStageState(deriveMeteringStage(input.status, input.installationStatus)),
  finalConfirmation: toStageState(deriveFinalConfirmationStage(input.status, input.installationStatus))
});

/** Last Excel column — mirrors frontend `lib/customer-journey.ts` file status label. */
export const deriveFileStatusLabel = (input: {
  status?: string | null;
  installationStatus?: string | null;
  installationReadyForInstaller?: boolean;
  fileLoginStatus?: string | null;
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
    return input.fileLoginStatus === 'already_login' ? 'File Logged In' : 'Pending File Login';
  }
  if (inst === 'mco') return 'MCO';
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
  const meteringStatus = deriveMeteringStatus(installationStatus);
  const journeyStageProgress = buildJourneyStageProgress({ status, installationStatus });
  const fileStatus = deriveFileStatusLabel({
    status,
    installationStatus,
    installationReadyForInstaller,
    fileLoginStatus
  });

  const instKey = String(installationStatus || 'pending_installer');
  const adminApprovalStatus = ADMIN_APPROVAL_LABELS[String(status || 'pending').toLowerCase()] || String(status || 'Pending');
  const installationStatusLabel = INSTALLATION_STATUS_LABELS[instKey] || instKey.replace(/_/g, ' ');
  const meteringStatusLabel = meteringStatus
    ? METERING_STATUS_LABELS[meteringStatus] || meteringStatus.replace(/_/g, ' ')
    : 'Not Started';
  const finalConfirmationStatusLabel =
    FINAL_CONFIRMATION_LABELS[instKey] ||
    (['baldev_approved', 'pending_metering', 'metering_in_progress', 'metering_approved', 'mco', 'completed'].includes(instKey)
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
    finalConfirmationStatusLabel,
    final_confirmation_status_label: finalConfirmationStatusLabel
  };
};
