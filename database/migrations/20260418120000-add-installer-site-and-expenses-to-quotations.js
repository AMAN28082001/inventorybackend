'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('quotations', 'siteLengthCm', {
      type: Sequelize.DECIMAL(12, 3),
      allowNull: true
    });
    await queryInterface.addColumn('quotations', 'siteWidthCm', {
      type: Sequelize.DECIMAL(12, 3),
      allowNull: true
    });
    await queryInterface.addColumn('quotations', 'siteHeightCm', {
      type: Sequelize.DECIMAL(12, 3),
      allowNull: true
    });
    await queryInterface.addColumn('quotations', 'backLegFt', {
      type: Sequelize.DECIMAL(12, 4),
      allowNull: true
    });
    await queryInterface.addColumn('quotations', 'midLegFt', {
      type: Sequelize.DECIMAL(12, 4),
      allowNull: true
    });
    await queryInterface.addColumn('quotations', 'frontLegFt', {
      type: Sequelize.DECIMAL(12, 4),
      allowNull: true
    });
    await queryInterface.addColumn('quotations', 'extraExpensesTotal', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true
    });
    await queryInterface.addColumn('quotations', 'extraExpensesJson', {
      type: Sequelize.JSONB,
      allowNull: true
    });

    await queryInterface.addColumn('quotations', 'meteringId', {
      type: Sequelize.STRING(50),
      allowNull: true
    });
    await queryInterface.addColumn('quotations', 'meteringActionAt', {
      type: Sequelize.DATE,
      allowNull: true
    });
    await queryInterface.addColumn('quotations', 'meteringApprovedAt', {
      type: Sequelize.DATE,
      allowNull: true
    });
    await queryInterface.addColumn('quotations', 'meteringRemarks', {
      type: Sequelize.TEXT,
      allowNull: true
    });
    await queryInterface.addColumn('quotations', 'mcoAt', {
      type: Sequelize.DATE,
      allowNull: true
    });

    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'enum_quotation_installation_docs_docType'
        ) THEN
          ALTER TYPE "enum_quotation_installation_docs_docType" ADD VALUE IF NOT EXISTS 'installer_pi';
        END IF;
        IF EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'enum_quotations_installationStatus'
        ) THEN
          ALTER TYPE "enum_quotations_installationStatus" ADD VALUE IF NOT EXISTS 'pending_metering';
          ALTER TYPE "enum_quotations_installationStatus" ADD VALUE IF NOT EXISTS 'metering_in_progress';
          ALTER TYPE "enum_quotations_installationStatus" ADD VALUE IF NOT EXISTS 'metering_approved';
          ALTER TYPE "enum_quotations_installationStatus" ADD VALUE IF NOT EXISTS 'mco';
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('quotations', 'mcoAt');
    await queryInterface.removeColumn('quotations', 'meteringRemarks');
    await queryInterface.removeColumn('quotations', 'meteringApprovedAt');
    await queryInterface.removeColumn('quotations', 'meteringActionAt');
    await queryInterface.removeColumn('quotations', 'meteringId');
    await queryInterface.removeColumn('quotations', 'extraExpensesJson');
    await queryInterface.removeColumn('quotations', 'extraExpensesTotal');
    await queryInterface.removeColumn('quotations', 'frontLegFt');
    await queryInterface.removeColumn('quotations', 'midLegFt');
    await queryInterface.removeColumn('quotations', 'backLegFt');
    await queryInterface.removeColumn('quotations', 'siteHeightCm');
    await queryInterface.removeColumn('quotations', 'siteWidthCm');
    await queryInterface.removeColumn('quotations', 'siteLengthCm');
  }
};
