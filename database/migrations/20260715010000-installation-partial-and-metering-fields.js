'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Partial Approved status (Postgres ENUM if present; STRING columns accept freely)
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'enum_quotations_installationStatus'
        ) THEN
          ALTER TYPE "enum_quotations_installationStatus"
            ADD VALUE IF NOT EXISTS 'installer_partial_approved';
        END IF;
      END
      $$;
    `);

    const table = await queryInterface.describeTable('quotations');

    const addIfMissing = async (column, spec) => {
      if (!table[column]) {
        await queryInterface.addColumn('quotations', column, spec);
      }
    };

    await addIfMissing('installationPartialApproved', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
    await addIfMissing('installationPartialApprovedAt', {
      type: Sequelize.DATE,
      allowNull: true
    });
    // meteringRemarks already exists; add authorized representative for Metering details card
    await addIfMissing('meteringAuthorizedRepresentative', {
      type: Sequelize.TEXT,
      allowNull: true
    });
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('quotations');
    if (table.meteringAuthorizedRepresentative) {
      await queryInterface.removeColumn('quotations', 'meteringAuthorizedRepresentative');
    }
    if (table.installationPartialApprovedAt) {
      await queryInterface.removeColumn('quotations', 'installationPartialApprovedAt');
    }
    if (table.installationPartialApproved) {
      await queryInterface.removeColumn('quotations', 'installationPartialApproved');
    }
    // Postgres cannot easily remove enum values — leave installer_partial_approved in type
  }
};
