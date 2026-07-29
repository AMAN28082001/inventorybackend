'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const addIndexIfMissing = async (tableName, indexName, fields) => {
      const existing = await queryInterface.showIndex(tableName);
      if (existing.some((idx) => idx.name === indexName)) return;
      await queryInterface.addIndex(tableName, fields, { name: indexName });
    };

    // Quotations list/report filters (status, payment, installation, sort by createdAt).
    await addIndexIfMissing('quotations', 'idx_quotation_status_payment_status', ['status', 'paymentStatus']);
    await addIndexIfMissing(
      'quotations',
      'idx_quotation_status_installation_status_created',
      ['status', 'installationStatus', 'createdAt']
    );
    await addIndexIfMissing('quotations', 'idx_quotation_dealer_created', ['dealerId', 'createdAt']);
    await addIndexIfMissing('quotations', 'idx_quotation_payment_status_created', ['paymentStatus', 'createdAt']);

    // Dealer calling analytics/history (high-frequency order/filter by dealer + action time).
    await addIndexIfMissing(
      'calling_action_history',
      'idx_calling_action_history_dealer_action_actionat',
      ['dealerId', 'action', 'actionAt']
    );
  },

  async down(queryInterface) {
    const dropIfExists = async (tableName, indexName) => {
      const existing = await queryInterface.showIndex(tableName);
      if (!existing.some((idx) => idx.name === indexName)) return;
      await queryInterface.removeIndex(tableName, indexName);
    };

    await dropIfExists('calling_action_history', 'idx_calling_action_history_dealer_action_actionat');
    await dropIfExists('quotations', 'idx_quotation_payment_status_created');
    await dropIfExists('quotations', 'idx_quotation_dealer_created');
    await dropIfExists('quotations', 'idx_quotation_status_installation_status_created');
    await dropIfExists('quotations', 'idx_quotation_status_payment_status');
  }
};

