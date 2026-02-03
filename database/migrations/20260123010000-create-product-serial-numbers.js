'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('product_serial_numbers', {
      id: {
        type: Sequelize.STRING(50),
        primaryKey: true,
        allowNull: false
      },
      product_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
        references: {
          model: 'products',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      serial_number: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true
      },
      stock_addition_id: {
        type: Sequelize.STRING(50),
        allowNull: true
      },
      owner_id: {
        type: Sequelize.STRING(50),
        allowNull: true
      },
      owner_type: {
        type: Sequelize.ENUM('super-admin', 'admin', 'agent'),
        allowNull: true
      },
      status: {
        type: Sequelize.ENUM('available', 'sold', 'returned', 'damaged'),
        allowNull: false,
        defaultValue: 'available'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('product_serial_numbers', ['product_id'], {
      name: 'idx_product_serial_numbers_product'
    });
    await queryInterface.addIndex('product_serial_numbers', ['serial_number'], {
      name: 'idx_product_serial_numbers_serial'
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('product_serial_numbers');
  }
};
