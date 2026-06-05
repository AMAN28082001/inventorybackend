'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();

    await queryInterface.addColumn('calling_leads', 'kNumber', {
      type: Sequelize.STRING(100),
      allowNull: true
    });

    await queryInterface.addColumn('calling_leads', 'address', {
      type: Sequelize.TEXT,
      allowNull: true
    });

    await queryInterface.addColumn('calling_leads', 'customerNote', {
      type: Sequelize.TEXT,
      allowNull: true
    });

    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        DO $$ BEGIN
          ALTER TYPE "enum_dealer_lead_assignments_status" ADD VALUE IF NOT EXISTS 'queued';
        EXCEPTION WHEN duplicate_object THEN null;
        END $$;
      `);
      await queryInterface.sequelize.query(`
        DO $$ BEGIN
          ALTER TYPE "enum_dealer_lead_assignments_status" ADD VALUE IF NOT EXISTS 'rescheduled';
        EXCEPTION WHEN duplicate_object THEN null;
        END $$;
      `);
      await queryInterface.sequelize.query(`
        DO $$ BEGIN
          ALTER TYPE "enum_dealer_lead_assignments_action" ADD VALUE IF NOT EXISTS 'rescheduled';
        EXCEPTION WHEN duplicate_object THEN null;
        END $$;
      `);
    } else {
      await queryInterface.sequelize.query(`
        ALTER TABLE dealer_lead_assignments
        MODIFY COLUMN status ENUM('queued', 'assigned', 'in_progress', 'rescheduled', 'completed') NOT NULL DEFAULT 'assigned'
      `);
      await queryInterface.sequelize.query(`
        ALTER TABLE dealer_lead_assignments
        MODIFY COLUMN action ENUM('called', 'follow_up', 'not_interested', 'rescheduled') NULL
      `);
    }

    await queryInterface.addColumn('dealer_lead_assignments', 'callRemark', {
      type: Sequelize.TEXT,
      allowNull: true
    });

    await queryInterface.addColumn('dealer_lead_assignments', 'nextFollowUpAt', {
      type: Sequelize.DATE,
      allowNull: true
    });

    await queryInterface.addIndex('dealer_lead_assignments', ['dealerId', 'status', 'nextFollowUpAt'], {
      name: 'idx_dealer_lead_assignments_dealer_status_followup'
    });
  },

  async down(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();

    await queryInterface.removeIndex('dealer_lead_assignments', 'idx_dealer_lead_assignments_dealer_status_followup');
    await queryInterface.removeColumn('dealer_lead_assignments', 'nextFollowUpAt');
    await queryInterface.removeColumn('dealer_lead_assignments', 'callRemark');

    if (dialect !== 'postgres') {
      await queryInterface.sequelize.query(`
        ALTER TABLE dealer_lead_assignments
        MODIFY COLUMN status ENUM('assigned', 'in_progress', 'completed') NOT NULL DEFAULT 'assigned'
      `);
      await queryInterface.sequelize.query(`
        ALTER TABLE dealer_lead_assignments
        MODIFY COLUMN action ENUM('called', 'follow_up', 'not_interested') NULL
      `);
    }

    await queryInterface.removeColumn('calling_leads', 'customerNote');
    await queryInterface.removeColumn('calling_leads', 'address');
    await queryInterface.removeColumn('calling_leads', 'kNumber');
  }
};
