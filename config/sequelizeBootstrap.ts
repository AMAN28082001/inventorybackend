import sequelize from './database';
import logger from './logger';

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

/**
 * Resolves after DB auth + lightweight schema fixes. Server should await this before binding the port
 * so the first request never hits a missing-column error.
 */
export const sequelizeBootstrap = (async (): Promise<void> => {
  try {
    await sequelize.authenticate();
    await ensureInstallationScheduledAtColumn();
    logger.info('PostgreSQL database connected successfully');
    console.log('✅ PostgreSQL database connected successfully');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Database connection error', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined
    });
    console.error('❌ Database connection error:', errorMessage);
  }
})();
