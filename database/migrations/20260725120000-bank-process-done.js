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

    await addIfMissing('bankProcessDone', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
    await addIfMissing('bankProcessDoneAt', {
      type: Sequelize.DATE,
      allowNull: true
    });
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('quotations');
    for (const column of ['bankProcessDoneAt', 'bankProcessDone']) {
      if (table[column]) {
        await queryInterface.removeColumn('quotations', column);
      }
    }
  }
};
