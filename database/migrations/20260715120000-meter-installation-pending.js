'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'enum_quotations_installationStatus'
        ) THEN
          ALTER TYPE "enum_quotations_installationStatus"
            ADD VALUE IF NOT EXISTS 'meter_installation_pending';
        END IF;
      END
      $$;
    `);

    const table = await queryInterface.describeTable('quotations');
    const addIfMissing = async (column, spec) => {
      if (!table[column]) {
        await queryInterface.addColumn('quotations', column, spec);
        table[column] = true;
      }
    };

    await addIfMissing('meterInstallationPendingAt', {
      type: Sequelize.DATE,
      allowNull: true
    });
    await addIfMissing('discomLocation', {
      type: Sequelize.TEXT,
      allowNull: true
    });
    await addIfMissing('meterInstallationPhotoUrl', {
      type: Sequelize.TEXT,
      allowNull: true
    });
    await addIfMissing('meterInstallationPhotoName', {
      type: Sequelize.STRING(255),
      allowNull: true
    });
    await addIfMissing('plantLivePhotoUrl', {
      type: Sequelize.TEXT,
      allowNull: true
    });
    await addIfMissing('plantLivePhotoName', {
      type: Sequelize.STRING(255),
      allowNull: true
    });
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('quotations');
    for (const column of [
      'plantLivePhotoName',
      'plantLivePhotoUrl',
      'meterInstallationPhotoName',
      'meterInstallationPhotoUrl',
      'discomLocation',
      'meterInstallationPendingAt'
    ]) {
      if (table[column]) {
        await queryInterface.removeColumn('quotations', column);
      }
    }
  }
};
