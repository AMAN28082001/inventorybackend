export const INSTALLER_RELEASE_STATUSES = [
  'pending_installer',
  'installer_in_progress',
  'installer_approved',
  'pending_baldev',
  'baldev_approved',
  'completed'
] as const;

export const resolveInstallerQueueStatuses = (statusQuery: string | undefined): string => {
  const raw = String(statusQuery || '').trim().toLowerCase();
  if (!raw) return INSTALLER_RELEASE_STATUSES.join(',');
  if (raw === 'pending_installer') return 'pending_installer';
  // Frontend compatibility: "approved" means installer-forward pipeline.
  if (raw === 'approved') return 'installer_approved,pending_baldev,baldev_approved,completed';
  return raw;
};
