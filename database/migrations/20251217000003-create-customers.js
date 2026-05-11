'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('customers', {
      id: {
        type: Sequelize.STRING(50),
        primaryKey: true,
        allowNull: false
      },
      firstName: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      lastName: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      mobile: {
        type: Sequelize.STRING(15),
        allowNull: false,
        unique: true
      },
      email: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      streetAddress: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      city: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      state: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      pincode: {
        type: Sequelize.STRING(6),
        allowNull: false
      },
      dealerId: {
        type: Sequelize.STRING(50),
        allowNull: true,
        references: {
          model: 'dealers',
          key: 'id'
        },
        onDelete: 'SET NULL'
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('customers', ['mobile'], { name: 'idx_customer_mobile' });
    await queryInterface.addIndex('customers', ['dealerId'], { name: 'idx_customer_dealer' });
    await queryInterface.addIndex('customers', ['state', 'city'], { name: 'idx_customer_location' });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('customers');
  }
};

