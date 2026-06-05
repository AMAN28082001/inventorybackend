'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('quotations', 'paymentMode', {
      type: Sequelize.STRING(30),
      allowNull: true
    });

    await queryInterface.addColumn('quotations', 'paidAmount', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: true
    });

    await queryInterface.addColumn('quotations', 'paymentDate', {
      type: Sequelize.DATEONLY,
      allowNull: true
    });

    await queryInterface.addColumn('quotations', 'paymentStatus', {
      type: Sequelize.ENUM('pending', 'partial', 'completed'),
      allowNull: true,
      defaultValue: 'pending'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('quotations', 'paymentStatus');
    await queryInterface.removeColumn('quotations', 'paymentDate');
    await queryInterface.removeColumn('quotations', 'paidAmount');
    await queryInterface.removeColumn('quotations', 'paymentMode');

    // Cleanup enum type in Postgres
    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS \"enum_quotations_paymentStatus\";');
    }
  }
};
