'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('quotations');
    const addIfMissing = async (column, spec) => {
      if (!table[column]) {
        await queryInterface.addColumn('quotations', column, spec);
        table[column] = true;
      }
    };

    await addIfMissing('finalSettlementAmount', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true
    });
    await addIfMissing('finalSettlementApplied', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
    await addIfMissing('finalSettlementAt', {
      type: Sequelize.DATE,
      allowNull: true
    });
    // finalSettlementBy added in a follow-up migration (20260721120000-final-settlement-by.js).
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('quotations');
    for (const column of [
      'finalSettlementAt',
      'finalSettlementApplied',
      'finalSettlementAmount'
    ]) {
      if (table[column]) {
        await queryInterface.removeColumn('quotations', column);
      }
    }
  }
};
