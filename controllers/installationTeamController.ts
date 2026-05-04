import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import { InstallationTeam, Quotation } from '../models/index-quotation';
import { logError } from '../utils/loggerHelper';
import { quotationAdminMetadataFields } from '../utils/quotationApiJson';

export const listInstallationTeams = async (_req: Request, res: Response): Promise<void> => {
  try {
    const teams = await InstallationTeam.findAll({
      attributes: { exclude: ['password'] },
      order: [['createdAt', 'ASC']]
    });
    res.json({
      success: true,
      data: {
        teams: teams.map((t) => {
          const row = t.get({ plain: true }) as unknown as Record<string, unknown>;
          return {
            id: row.id,
            name: row.name,
            username: row.username,
            isActive: Boolean(row.isActive),
            createdBy: row.createdBy ?? null,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt
          };
        })
      }
    });
  } catch (error) {
    logError('List installation teams error', error);
    res.status(500).json({ success: false, error: { code: 'SYS_001', message: 'Internal server error' } });
  }
};

export const createInstallationTeam = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, username, password } = req.body as { name: string; username: string; password: string };
    const existing = await InstallationTeam.findOne({ where: { username: username.trim() } });
    if (existing) {
      res.status(409).json({
        success: false,
        error: { code: 'VAL_001', message: 'Username already in use' }
      });
      return;
    }

    const createdBy =
      (req.dealer?.id as string | undefined) ||
      (req.user as { id?: string } | undefined)?.id ||
      null;
    const hash = await bcrypt.hash(password, 10);
    const team = await InstallationTeam.create({
      id: uuidv4(),
      name: name.trim(),
      username: username.trim(),
      password: hash,
      isActive: true,
      createdBy
    });

    const plain = team.get({ plain: true }) as unknown as Record<string, unknown>;
    res.status(201).json({
      success: true,
      data: {
        id: plain.id,
        name: plain.name,
        username: plain.username,
        isActive: plain.isActive,
        createdBy: plain.createdBy,
        createdAt: plain.createdAt,
        updatedAt: plain.updatedAt
      }
    });
  } catch (error) {
    logError('Create installation team error', error);
    res.status(500).json({ success: false, error: { code: 'SYS_001', message: 'Internal server error' } });
  }
};

export const patchInstallationTeam = async (req: Request, res: Response): Promise<void> => {
  try {
    const { teamId } = req.params;
    const team = await InstallationTeam.findByPk(teamId);
    if (!team) {
      res.status(404).json({ success: false, error: { code: 'RES_001', message: 'Team not found' } });
      return;
    }

    const body = req.body as {
      name?: string;
      username?: string;
      password?: string;
      isActive?: boolean;
    };
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = String(body.name).trim();
    if (body.username !== undefined) {
      const u = String(body.username).trim();
      const clash = await InstallationTeam.findOne({
        where: { username: u, id: { [Op.ne]: team.id } }
      });
      if (clash) {
        res.status(409).json({
          success: false,
          error: { code: 'VAL_001', message: 'Username already in use' }
        });
        return;
      }
      updates.username = u;
    }
    if (body.password !== undefined && body.password !== '') {
      updates.password = await bcrypt.hash(String(body.password), 10);
    }
    if (body.isActive !== undefined) updates.isActive = Boolean(body.isActive);

    if (Object.keys(updates).length === 0) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: 'No valid fields to update' }
      });
      return;
    }

    await team.update(updates);
    const plain = team.get({ plain: true }) as unknown as Record<string, unknown>;
    res.json({
      success: true,
      data: {
        id: plain.id,
        name: plain.name,
        username: plain.username,
        isActive: plain.isActive,
        createdBy: plain.createdBy,
        createdAt: plain.createdAt,
        updatedAt: plain.updatedAt
      }
    });
  } catch (error) {
    logError('Patch installation team error', error, { teamId: req.params.teamId });
    res.status(500).json({ success: false, error: { code: 'SYS_001', message: 'Internal server error' } });
  }
};

export const deleteInstallationTeam = async (req: Request, res: Response): Promise<void> => {
  try {
    const { teamId } = req.params;
    const team = await InstallationTeam.findByPk(teamId);
    if (!team) {
      res.status(404).json({ success: false, error: { code: 'RES_001', message: 'Team not found' } });
      return;
    }

    await Quotation.update({ installationTeamId: null }, { where: { installationTeamId: teamId } });
    await team.destroy();
    res.json({ success: true, data: { id: teamId, deleted: true } });
  } catch (error) {
    logError('Delete installation team error', error, { teamId: req.params.teamId });
    res.status(500).json({ success: false, error: { code: 'SYS_001', message: 'Internal server error' } });
  }
};

export const patchQuotationInstallationTeam = async (req: Request, res: Response): Promise<void> => {
  try {
    const { quotationId } = req.params;
    const body = req.body as {
      installationTeamId?: string | null;
      installation_team_id?: string | null;
    };

    const hasCamel = Object.prototype.hasOwnProperty.call(body, 'installationTeamId');
    const hasSnake = Object.prototype.hasOwnProperty.call(body, 'installation_team_id');
    if (!hasCamel && !hasSnake) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: 'installationTeamId or installation_team_id is required' }
      });
      return;
    }

    const raw = hasCamel ? body.installationTeamId : body.installation_team_id;
    const quotation = await Quotation.findByPk(quotationId);
    if (!quotation) {
      res.status(404).json({ success: false, error: { code: 'RES_001', message: 'Quotation not found' } });
      return;
    }

    if (raw === null || raw === '') {
      await quotation.update({ installationTeamId: null });
    } else {
      const team = await InstallationTeam.findByPk(String(raw).trim());
      if (!team || !team.isActive) {
        res.status(400).json({
          success: false,
          error: { code: 'VAL_001', message: 'Invalid or inactive installation team' }
        });
        return;
      }
      await quotation.update({ installationTeamId: team.id });
    }

    await quotation.reload();
    const rowPlain = quotation.get({ plain: true }) as unknown as Record<string, unknown>;
    res.json({
      success: true,
      data: {
        id: quotation.id,
        quotationId: quotation.id,
        ...quotationAdminMetadataFields(rowPlain),
        installationTeamId: quotation.installationTeamId ?? null,
        installation_team_id: quotation.installationTeamId ?? null,
        updatedAt: quotation.updatedAt
      }
    });
  } catch (error) {
    logError('Patch quotation installation team error', error, { quotationId: req.params.quotationId });
    res.status(500).json({ success: false, error: { code: 'SYS_001', message: 'Internal server error' } });
  }
};
