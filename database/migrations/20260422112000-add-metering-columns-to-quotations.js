'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('quotations');

    const ensureColumn = async (name, spec) => {
      if (!table[name]) {
        await queryInterface.addColumn('quotations', name, spec);
      }
    };

    await ensureColumn('meteringId', {
      type: Sequelize.STRING(50),
      allowNull: true
    });

    await ensureColumn('meteringActionAt', {
      type: Sequelize.DATE,
      allowNull: true
    });

    await ensureColumn('meteringApprovedAt', {
      type: Sequelize.DATE,
      allowNull: true
    });

    await ensureColumn('meteringRemarks', {
      type: Sequelize.TEXT,
      allowNull: true
    });

    await ensureColumn('mcoAt', {
      type: Sequelize.DATE,
      allowNull: true
    });

    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'enum_quotations_installationStatus'
        ) THEN
          ALTER TYPE "enum_quotations_installationStatus" ADD VALUE IF NOT EXISTS 'pending_metering';
          ALTER TYPE "enum_quotations_installationStatus" ADD VALUE IF NOT EXISTS 'metering_in_progress';
          ALTER TYPE "enum_quotations_installationStatus" ADD VALUE IF NOT EXISTS 'metering_approved';
          ALTER TYPE "enum_quotations_installationStatus" ADD VALUE IF NOT EXISTS 'mco';
        END IF;
      END
      $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('quotations', 'mcoAt');
    await queryInterface.removeColumn('quotations', 'meteringRemarks');
    await queryInterface.removeColumn('quotations', 'meteringApprovedAt');
    await queryInterface.removeColumn('quotations', 'meteringActionAt');
    await queryInterface.removeColumn('quotations', 'meteringId');
  }
};
