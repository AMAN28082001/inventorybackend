'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();

    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM pg_type t
            JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE t.typname = 'enum_dealer_lead_assignments_status'
          ) THEN
            ALTER TYPE "enum_dealer_lead_assignments_status" ADD VALUE IF NOT EXISTS 'active';
          END IF;
        END$$;
      `);
    } else {
      await queryInterface.sequelize.query(`
        ALTER TABLE dealer_lead_assignments
        MODIFY COLUMN status ENUM('queued', 'active', 'assigned', 'in_progress', 'rescheduled', 'completed')
        NOT NULL DEFAULT 'active'
      `);
    }
  },

  async down(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();

    if (dialect === 'postgres') {
      // PostgreSQL enum value removal is non-trivial; keep backward compatible state.
      return;
    }

    await queryInterface.sequelize.query(`
      ALTER TABLE dealer_lead_assignments
      MODIFY COLUMN status ENUM('queued', 'assigned', 'in_progress', 'rescheduled', 'completed')
      NOT NULL DEFAULT 'assigned'
    `);
  }
};

