'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('dealer_requests', {
      id: {
        type: Sequelize.STRING(50),
        primaryKey: true,
        allowNull: false
      },
      customerName: {
        type: Sequelize.STRING(150),
        allowNull: false
      },
      phoneNumber: {
        type: Sequelize.STRING(20),
        allowNull: false
      },
      email: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      city: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      state: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      address: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      source: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      status: {
        type: Sequelize.ENUM('new', 'in_progress', 'completed', 'rejected'),
        allowNull: false,
        defaultValue: 'new'
      },
      assignedDealerId: {
        type: Sequelize.STRING(50),
        allowNull: true,
        references: {
          model: 'dealers',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      assignedByAdminId: {
        type: Sequelize.STRING(50),
        allowNull: true
      },
      actionRemark: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      requestPayload: {
        type: Sequelize.JSONB,
        allowNull: true
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

    await queryInterface.addIndex('dealer_requests', ['createdAt'], { name: 'idx_dealer_requests_created_at' });
    await queryInterface.addIndex('dealer_requests', ['status'], { name: 'idx_dealer_requests_status' });
    await queryInterface.addIndex('dealer_requests', ['assignedDealerId'], { name: 'idx_dealer_requests_assigned_dealer' });
    await queryInterface.addIndex('dealer_requests', ['phoneNumber'], { name: 'idx_dealer_requests_phone' });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('dealer_requests', 'idx_dealer_requests_phone');
    await queryInterface.removeIndex('dealer_requests', 'idx_dealer_requests_assigned_dealer');
    await queryInterface.removeIndex('dealer_requests', 'idx_dealer_requests_status');
    await queryInterface.removeIndex('dealer_requests', 'idx_dealer_requests_created_at');
    await queryInterface.dropTable('dealer_requests');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_dealer_requests_status";');
  }
};
