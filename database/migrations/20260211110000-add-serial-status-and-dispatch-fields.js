'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();

    await queryInterface.addColumn('product_serial_numbers', 'stock_request_id', {
      type: Sequelize.STRING(50),
      allowNull: true
    });

    await queryInterface.addColumn('product_serial_numbers', 'dispatched_to_id', {
      type: Sequelize.STRING(50),
      allowNull: true
    });

    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`ALTER TYPE enum_product_serial_numbers_status ADD VALUE IF NOT EXISTS 'mapped'`);
      await queryInterface.sequelize.query(`ALTER TYPE enum_product_serial_numbers_status ADD VALUE IF NOT EXISTS 'dispatched'`);
      await queryInterface.sequelize.query(`ALTER TYPE enum_product_serial_numbers_status ADD VALUE IF NOT EXISTS 'acknowledged'`);
    } else if (dialect === 'mysql' || dialect === 'mariadb') {
      await queryInterface.changeColumn('product_serial_numbers', 'status', {
        type: Sequelize.ENUM('available', 'mapped', 'dispatched', 'acknowledged', 'sold', 'returned', 'damaged'),
        allowNull: false,
        defaultValue: 'available'
      });
    }

    await queryInterface.addIndex('product_serial_numbers', ['status'], {
      name: 'idx_product_serial_numbers_status'
    });
    await queryInterface.addIndex('product_serial_numbers', ['stock_request_id'], {
      name: 'idx_product_serial_numbers_stock_request_id'
    });
  },

  async down(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();
    await queryInterface.removeIndex('product_serial_numbers', 'idx_product_serial_numbers_stock_request_id');
    await queryInterface.removeIndex('product_serial_numbers', 'idx_product_serial_numbers_status');
    await queryInterface.removeColumn('product_serial_numbers', 'dispatched_to_id');
    await queryInterface.removeColumn('product_serial_numbers', 'stock_request_id');

    if (dialect === 'mysql' || dialect === 'mariadb') {
      await queryInterface.changeColumn('product_serial_numbers', 'status', {
        type: Sequelize.ENUM('available', 'sold', 'returned', 'damaged'),
        allowNull: false,
        defaultValue: 'available'
      });
    }
  }
};
