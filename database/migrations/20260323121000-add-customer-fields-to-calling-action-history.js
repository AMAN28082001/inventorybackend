'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('calling_action_history', 'customerName', {
      type: Sequelize.STRING(150),
      allowNull: true
    });
    await queryInterface.addColumn('calling_action_history', 'customerMobile', {
      type: Sequelize.STRING(20),
      allowNull: true
    });
    await queryInterface.addColumn('calling_action_history', 'customerAddress', {
      type: Sequelize.TEXT,
      allowNull: true
    });

    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        UPDATE calling_action_history h
        SET
          "customerName" = l."name",
          "customerMobile" = l."mobile",
          "customerAddress" = TRIM(
            CONCAT(
              COALESCE(l."address", ''),
              CASE WHEN l."city" IS NOT NULL AND l."city" <> '' THEN ', ' || l."city" ELSE '' END,
              CASE WHEN l."state" IS NOT NULL AND l."state" <> '' THEN ', ' || l."state" ELSE '' END
            )
          )
        FROM calling_leads l
        WHERE h."leadId" = l."id";
      `);
    } else {
      await queryInterface.sequelize.query(`
        UPDATE calling_action_history h
        JOIN calling_leads l ON h.leadId = l.id
        SET
          h.customerName = l.name,
          h.customerMobile = l.mobile,
          h.customerAddress = TRIM(CONCAT(
            COALESCE(l.address, ''),
            CASE WHEN l.city IS NOT NULL AND l.city <> '' THEN CONCAT(', ', l.city) ELSE '' END,
            CASE WHEN l.state IS NOT NULL AND l.state <> '' THEN CONCAT(', ', l.state) ELSE '' END
          ));
      `);
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('calling_action_history', 'customerAddress');
    await queryInterface.removeColumn('calling_action_history', 'customerMobile');
    await queryInterface.removeColumn('calling_action_history', 'customerName');
  }
};
