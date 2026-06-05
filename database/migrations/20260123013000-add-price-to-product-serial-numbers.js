'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('product_serial_numbers', 'price', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true
    });

    await queryInterface.addIndex('product_serial_numbers', ['price'], {
      name: 'idx_product_serial_numbers_price',
      where: { price: { [Sequelize.Op.ne]: null } }
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('product_serial_numbers', 'idx_product_serial_numbers_price');
    await queryInterface.removeColumn('product_serial_numbers', 'price');
  }
};
