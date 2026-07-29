'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('sales');
    if (!table.admin_id) {
      await queryInterface.addColumn('sales', 'admin_id', {
        type: Sequelize.STRING(50),
        allowNull: true,
        references: {
          model: 'users',
          key: 'id'
        },
        onDelete: 'SET NULL'
      });
    }
    const indexes = await queryInterface.showIndex('sales');
    const hasIdx = (indexes || []).some(
      (idx) => idx.name === 'idx_sales_admin_id' || (idx.fields || []).includes('admin_id')
    );
    if (!hasIdx) {
      await queryInterface.addIndex('sales', ['admin_id'], {
        name: 'idx_sales_admin_id'
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('sales');
    try {
      await queryInterface.removeIndex('sales', 'idx_sales_admin_id');
    } catch (_) {
      /* ignore */
    }
    if (table.admin_id) {
      await queryInterface.removeColumn('sales', 'admin_id');
    }
  }
};
