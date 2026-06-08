import sequelize from './database';
import logger from './logger';

/** Idempotent: Payment Management → Admin Installation release flags. */
const ensureInstallationReleaseColumns = async (): Promise<void> => {
  try {
    await sequelize.query(
      'ALTER TABLE quotations ADD COLUMN IF NOT EXISTS "installationReadyForInstaller" BOOLEAN NOT NULL DEFAULT false;'
    );
    await sequelize.query(
      'ALTER TABLE quotations ADD COLUMN IF NOT EXISTS "installationReleasedAt" TIMESTAMPTZ NULL;'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Could not ensure quotations installation release columns', { message });
  }
};

/** Idempotent: keeps Sequelize model and DB in sync (avoids 500 on GET /api/quotations). */
const ensureInstallationScheduledAtColumn = async (): Promise<void> => {
  try {
    await sequelize.query(
      'ALTER TABLE quotations ADD COLUMN IF NOT EXISTS "installationScheduledAt" DATE NULL;'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Could not ensure quotations.installationScheduledAt column', { message });
  }
};

const ensureSystemKwColumn = async (): Promise<void> => {
  try {
    await sequelize.query(
      'ALTER TABLE quotations ADD COLUMN IF NOT EXISTS system_kw NUMERIC(10, 2) NULL;'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Could not ensure quotations.system_kw column', { message });
  }
};

const ensureProductUnitColumn = async (): Promise<void> => {
  try {
    await sequelize.query(
      'ALTER TABLE products ADD COLUMN IF NOT EXISTS unit VARCHAR(50) NULL;'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Could not ensure products.unit column', { message });
  }
};

const ensureInstallationTeamsSchema = async (): Promise<void> => {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS "installation_teams" (
        "id" VARCHAR(50) PRIMARY KEY,
        "name" VARCHAR(255) NOT NULL,
        "username" VARCHAR(50) NOT NULL UNIQUE,
        "password" VARCHAR(255) NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdBy" VARCHAR(50) NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await sequelize.query(
      'ALTER TABLE quotations ADD COLUMN IF NOT EXISTS "installationTeamId" VARCHAR(50) NULL;'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Could not ensure installation_teams / quotations.installationTeamId', { message });
  }
};

/**
 * Resolves after DB auth + lightweight schema fixes. Server should await this before binding the port
 * so the first request never hits a missing-column error.
 */
export const sequelizeBootstrap = (async (): Promise<void> => {
  try {
    await sequelize.authenticate();
    await ensureInstallationReleaseColumns();
    await ensureProductUnitColumn();
    await ensureInstallationScheduledAtColumn();
    await ensureSystemKwColumn();
    await ensureInstallationTeamsSchema();
    logger.info('PostgreSQL database connected successfully');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Database connection error', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined
    });
  }
})();
