'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('calling_action_history', {
      id: {
        type: Sequelize.STRING(50),
        allowNull: false,
        primaryKey: true
      },
      leadId: {
        type: Sequelize.STRING(50),
        allowNull: false,
        references: {
          model: 'calling_leads',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      dealerId: {
        type: Sequelize.STRING(50),
        allowNull: false,
        references: {
          model: 'dealers',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
      },
      action: {
        type: Sequelize.ENUM('start', 'called', 'follow_up', 'not_interested', 'rescheduled'),
        allowNull: false
      },
      callRemark: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      actionAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      nextFollowUpAt: {
        type: Sequelize.DATE,
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

    await queryInterface.addIndex('calling_action_history', ['actionAt'], {
      name: 'idx_calling_action_history_action_at'
    });
    await queryInterface.addIndex('calling_action_history', ['dealerId'], {
      name: 'idx_calling_action_history_dealer_id'
    });
    await queryInterface.addIndex('calling_action_history', ['action'], {
      name: 'idx_calling_action_history_action'
    });
    await queryInterface.addIndex('calling_action_history', ['dealerId', 'actionAt'], {
      name: 'idx_calling_action_history_dealer_action_at'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('calling_action_history', 'idx_calling_action_history_dealer_action_at');
    await queryInterface.removeIndex('calling_action_history', 'idx_calling_action_history_action');
    await queryInterface.removeIndex('calling_action_history', 'idx_calling_action_history_dealer_id');
    await queryInterface.removeIndex('calling_action_history', 'idx_calling_action_history_action_at');
    await queryInterface.dropTable('calling_action_history');
  }
};
