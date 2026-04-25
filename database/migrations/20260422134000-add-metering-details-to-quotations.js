'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('quotations');

    const addIfMissing = async (column, spec) => {
      if (!table[column]) {
        await queryInterface.addColumn('quotations', column, spec);
      }
    };

    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_quotations_meterType') THEN
          -- already exists
          NULL;
        ELSE
          CREATE TYPE "enum_quotations_meterType" AS ENUM ('solar', 'net', 'both');
        END IF;
      END
      $$;
    `);

    await addIfMissing('discomName', {
      type: Sequelize.STRING(255),
      allowNull: true
    });
    await addIfMissing('meterType', {
      type: Sequelize.ENUM('solar', 'net', 'both'),
      allowNull: true
    });
    await addIfMissing('meterNo', {
      type: Sequelize.STRING(120),
      allowNull: true
    });
    await addIfMissing('solarMeterNo', {
      type: Sequelize.STRING(120),
      allowNull: true
    });
    await addIfMissing('netMeterNo', {
      type: Sequelize.STRING(120),
      allowNull: true
    });
    await addIfMissing('meterDocumentImageUrl', {
      type: Sequelize.TEXT,
      allowNull: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('quotations', 'meterDocumentImageUrl');
    await queryInterface.removeColumn('quotations', 'netMeterNo');
    await queryInterface.removeColumn('quotations', 'solarMeterNo');
    await queryInterface.removeColumn('quotations', 'meterNo');
    await queryInterface.removeColumn('quotations', 'meterType');
    await queryInterface.removeColumn('quotations', 'discomName');
  }
};
