'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('calling_action_history', 'statusCategory', {
      type: Sequelize.STRING(64),
      allowNull: true
    });

    await queryInterface.addColumn('calling_action_history', 'statusLabel', {
      type: Sequelize.STRING(128),
      allowNull: true
    });

    await queryInterface.addColumn('calling_action_history', 'statusReason', {
      type: Sequelize.STRING(255),
      allowNull: true
    });

    await queryInterface.addColumn('calling_action_history', 'isCustomReason', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });

    await queryInterface.addIndex('calling_action_history', ['statusCategory', 'statusReason', 'actionAt'], {
      name: 'calling_action_history_status_category_reason_action_at_idx'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('calling_action_history', 'calling_action_history_status_category_reason_action_at_idx');
    await queryInterface.removeColumn('calling_action_history', 'isCustomReason');
    await queryInterface.removeColumn('calling_action_history', 'statusReason');
    await queryInterface.removeColumn('calling_action_history', 'statusLabel');
    await queryInterface.removeColumn('calling_action_history', 'statusCategory');
  }
};
