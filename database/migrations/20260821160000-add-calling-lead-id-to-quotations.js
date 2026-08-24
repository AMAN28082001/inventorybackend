'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('quotations');
    if (!table.calling_lead_id && !table.callingLeadId) {
      await queryInterface.addColumn('quotations', 'calling_lead_id', {
        type: Sequelize.STRING(50),
        allowNull: true
      });
    }
    const indexes = await queryInterface.showIndex('quotations');
    const hasIndex = (indexes || []).some(
      (idx) =>
        idx.name === 'idx_quotations_calling_lead_id' ||
        (Array.isArray(idx.fields) &&
          idx.fields.some((f) => String(f.name || f.attribute || f) === 'calling_lead_id'))
    );
    if (!hasIndex) {
      await queryInterface.addIndex('quotations', ['calling_lead_id'], {
        name: 'idx_quotations_calling_lead_id'
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('quotations');
    try {
      await queryInterface.removeIndex('quotations', 'idx_quotations_calling_lead_id');
    } catch (_) {
      /* ignore */
    }
    if (table.calling_lead_id) {
      await queryInterface.removeColumn('quotations', 'calling_lead_id');
    }
  }
};
