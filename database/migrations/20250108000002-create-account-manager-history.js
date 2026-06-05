'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('account_manager_history', {
      id: {
        type: Sequelize.STRING(255),
        primaryKey: true,
        allowNull: false
      },
      accountManagerId: {
        type: Sequelize.STRING(255),
        allowNull: false,
        references: {
          model: 'account_managers',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      action: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      details: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      ipAddress: {
        type: Sequelize.STRING(45),
        allowNull: true
      },
      userAgent: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      timestamp: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('account_manager_history', ['accountManagerId'], { name: 'idx_account_manager_history_accountManagerId' });
    await queryInterface.addIndex('account_manager_history', ['action'], { name: 'idx_account_manager_history_action' });
    await queryInterface.addIndex('account_manager_history', ['timestamp'], { name: 'idx_account_manager_history_timestamp' });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('account_manager_history');
  }
};
