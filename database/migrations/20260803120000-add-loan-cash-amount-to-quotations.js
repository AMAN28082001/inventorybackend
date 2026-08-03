'use strict';

/** §28 — persist Cash + loan split on quotations (loan_amount / cash_amount). */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('quotations');
    if (!table.loan_amount && !table.loanAmount) {
      await queryInterface.addColumn('quotations', 'loan_amount', {
        type: Sequelize.DECIMAL(14, 2),
        allowNull: true
      });
    }
    if (!table.cash_amount && !table.cashAmount) {
      await queryInterface.addColumn('quotations', 'cash_amount', {
        type: Sequelize.DECIMAL(14, 2),
        allowNull: true
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('quotations');
    if (table.loan_amount) {
      await queryInterface.removeColumn('quotations', 'loan_amount');
    }
    if (table.cash_amount) {
      await queryInterface.removeColumn('quotations', 'cash_amount');
    }
  }
};
