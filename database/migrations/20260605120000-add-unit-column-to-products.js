'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('products');
    if (!table.unit) {
      await queryInterface.addColumn('products', 'unit', {
        type: Sequelize.STRING(50),
        allowNull: true
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('products');
    if (table.unit) {
      await queryInterface.removeColumn('products', 'unit');
    }
  }
};
