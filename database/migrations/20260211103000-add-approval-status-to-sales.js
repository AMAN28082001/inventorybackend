'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('sales', 'approval_status', {
      type: Sequelize.ENUM('pending', 'approved'),
      allowNull: false,
      defaultValue: 'pending'
    });

    await queryInterface.sequelize.query(`
      UPDATE sales
      SET approval_status = 'approved'
      WHERE approval_status = 'pending' AND payment_status = 'completed'
    `);

    await queryInterface.addIndex('sales', ['approval_status'], {
      name: 'idx_sales_approval_status'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('sales', 'idx_sales_approval_status');
    await queryInterface.removeColumn('sales', 'approval_status');
  }
};
