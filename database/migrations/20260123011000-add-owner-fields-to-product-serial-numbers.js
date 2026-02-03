'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = 'product_serial_numbers';

    await queryInterface.addColumn(table, 'owner_id', {
      type: Sequelize.STRING(50),
      allowNull: true
    });

    await queryInterface.addColumn(table, 'owner_type', {
      type: Sequelize.ENUM('super-admin', 'admin', 'agent'),
      allowNull: true
    });

    await queryInterface.addColumn(table, 'status', {
      type: Sequelize.ENUM('available', 'sold', 'returned', 'damaged'),
      allowNull: false,
      defaultValue: 'available'
    });
  },

  async down(queryInterface) {
    const table = 'product_serial_numbers';
    await queryInterface.removeColumn(table, 'status');
    await queryInterface.removeColumn(table, 'owner_type');
    await queryInterface.removeColumn(table, 'owner_id');
  }
};
