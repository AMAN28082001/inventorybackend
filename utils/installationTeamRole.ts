import type { Request } from 'express';

/** JWT / user.role values accepted for field-team logins (normalized for comparison). */
export function normalizeInstallationTeamRole(role: string | undefined): string {
  if (!role) return '';
  return role.toLowerCase().replace(/-/g, '_');
}

export function isInstallationTeamJwtRole(role: string | undefined): boolean {
  const r = normalizeInstallationTeamRole(role);
  return r === 'installation_team' || r === 'installationteam' || r === 'field_team' || r === 'fieldteam';
}

/** Resolved team id for queue filter / quotation scope (from JWT body or user). */
export function getInstallationTeamIdFromRequest(req: Request): string | null {
  const u = req.user as { installationTeamId?: string; id?: string; role?: string } | undefined;
  if (!u || !isInstallationTeamJwtRole(u.role)) return null;
  return (u.installationTeamId || u.id || '').trim() || null;
}
