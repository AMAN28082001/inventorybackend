'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableName = 'quotation_documents';
    const table = await queryInterface.describeTable(tableName);

    const addIfMissing = async (column, definition) => {
      if (!table[column]) {
        await queryInterface.addColumn(tableName, column, definition);
      }
    };

    await addIfMissing('customerFinalBillFile', {
      type: Sequelize.STRING(255),
      allowNull: true
    });
    await addIfMissing('panelWarrantyFile', {
      type: Sequelize.STRING(255),
      allowNull: true
    });
    await addIfMissing('inverterWarrantyFile', {
      type: Sequelize.STRING(255),
      allowNull: true
    });
    await addIfMissing('workCompletionWarrantyFile', {
      type: Sequelize.STRING(255),
      allowNull: true
    });
  },

  async down(queryInterface) {
    const tableName = 'quotation_documents';
    const table = await queryInterface.describeTable(tableName);
    const dropIfExists = async (column) => {
      if (table[column]) {
        await queryInterface.removeColumn(tableName, column);
      }
    };

    await dropIfExists('workCompletionWarrantyFile');
    await dropIfExists('inverterWarrantyFile');
    await dropIfExists('panelWarrantyFile');
    await dropIfExists('customerFinalBillFile');
  }
};
