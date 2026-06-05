'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('calling_action_history', 'dealerName', {
      type: Sequelize.STRING(200),
      allowNull: true
    });

    await queryInterface.addColumn('calling_action_history', 'reasonCategory', {
      type: Sequelize.ENUM('interested', 'follow_up', 'not_interested', 'others'),
      allowNull: true
    });

    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        UPDATE calling_action_history h
        SET "dealerName" = TRIM(COALESCE(d."firstName", '') || ' ' || COALESCE(d."lastName", ''))
        FROM dealers d
        WHERE h."dealerId" = d."id"
          AND (h."dealerName" IS NULL OR h."dealerName" = '');
      `);

      await queryInterface.sequelize.query(`
        UPDATE calling_action_history
        SET "reasonCategory" = CASE
          WHEN "action"::text = 'called' THEN 'interested'::"enum_calling_action_history_reasonCategory"
          WHEN "action"::text = 'follow_up' THEN 'follow_up'::"enum_calling_action_history_reasonCategory"
          WHEN "action"::text = 'not_interested' THEN 'not_interested'::"enum_calling_action_history_reasonCategory"
          ELSE 'others'::"enum_calling_action_history_reasonCategory"
        END
        WHERE "reasonCategory" IS NULL;
      `);
    } else {
      await queryInterface.sequelize.query(`
        UPDATE calling_action_history h
        JOIN dealers d ON h.dealerId = d.id
        SET h.dealerName = TRIM(CONCAT(COALESCE(d.firstName, ''), ' ', COALESCE(d.lastName, '')))
        WHERE h.dealerName IS NULL OR h.dealerName = '';
      `);

      await queryInterface.sequelize.query(`
        UPDATE calling_action_history
        SET reasonCategory = CASE
          WHEN action = 'called' THEN 'interested'
          WHEN action = 'follow_up' THEN 'follow_up'
          WHEN action = 'not_interested' THEN 'not_interested'
          ELSE 'others'
        END
        WHERE reasonCategory IS NULL;
      `);
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('calling_action_history', 'reasonCategory');
    await queryInterface.removeColumn('calling_action_history', 'dealerName');
  }
};
