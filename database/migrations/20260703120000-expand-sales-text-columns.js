'use strict';

const B2B_BILL_STATUS_VIEW = `
CREATE OR REPLACE VIEW v_b2b_bill_status AS
SELECT
    s.id,
    s.customer_name,
    s.company_name,
    s.product_summary,
    s.total_amount,
    s.payment_status,
    CASE
        WHEN s.bill_image IS NOT NULL THEN 'Bill Uploaded'
        ELSE 'Bill Pending'
    END AS bill_status,
    s.bill_confirmed_date,
    s.bill_confirmed_by_name
FROM sales s
WHERE s.type = 'B2B'
ORDER BY s.sale_date DESC;
`;

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query('DROP VIEW IF EXISTS v_b2b_bill_status;');

    await queryInterface.changeColumn('sales', 'product_summary', {
      type: Sequelize.TEXT,
      allowNull: false,
    });
    await queryInterface.changeColumn('sales', 'image', {
      type: Sequelize.STRING(2048),
      allowNull: true,
    });
    await queryInterface.changeColumn('sales', 'bill_image', {
      type: Sequelize.STRING(2048),
      allowNull: true,
    });

    await queryInterface.sequelize.query(B2B_BILL_STATUS_VIEW);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query('DROP VIEW IF EXISTS v_b2b_bill_status;');

    await queryInterface.changeColumn('sales', 'product_summary', {
      type: Sequelize.STRING(500),
      allowNull: false,
    });
    await queryInterface.changeColumn('sales', 'image', {
      type: Sequelize.STRING(500),
      allowNull: true,
    });
    await queryInterface.changeColumn('sales', 'bill_image', {
      type: Sequelize.STRING(500),
      allowNull: true,
    });

    await queryInterface.sequelize.query(B2B_BILL_STATUS_VIEW);
  },
};
