'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('product_serial_numbers', 'cost_price', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true
    });

    await queryInterface.sequelize.query(`
      UPDATE product_serial_numbers
      SET cost_price = price
      WHERE cost_price IS NULL AND price IS NOT NULL
    `);

    await queryInterface.addIndex('product_serial_numbers', ['cost_price'], {
      name: 'idx_product_serial_numbers_cost_price'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('product_serial_numbers', 'idx_product_serial_numbers_cost_price');
    await queryInterface.removeColumn('product_serial_numbers', 'cost_price');
  }
};
