'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('account_managers', {
      id: {
        type: Sequelize.STRING(255),
        primaryKey: true,
        allowNull: false
      },
      username: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true
      },
      password: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      firstName: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      lastName: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      email: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true
      },
      mobile: {
        type: Sequelize.STRING(20),
        allowNull: false
      },
      role: {
        type: Sequelize.STRING(50),
        defaultValue: 'account-management',
        allowNull: false
      },
      isActive: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      emailVerified: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      loginCount: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      lastLogin: {
        type: Sequelize.DATE,
        allowNull: true
      },
      createdBy: {
        type: Sequelize.STRING(255),
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

    await queryInterface.addIndex('account_managers', ['username'], { name: 'idx_account_manager_username' });
    await queryInterface.addIndex('account_managers', ['email'], { name: 'idx_account_manager_email' });
    await queryInterface.addIndex('account_managers', ['isActive'], { name: 'idx_account_manager_isActive' });
    await queryInterface.addIndex('account_managers', ['createdAt'], { name: 'idx_account_manager_createdAt' });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('account_managers');
  }
};
