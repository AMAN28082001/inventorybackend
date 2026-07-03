'use strict';

const VIEWS_TO_RECREATE = {
  v_admin_inventory_summary: `
CREATE OR REPLACE VIEW v_admin_inventory_summary AS
SELECT
    u.id AS admin_id,
    u.name AS admin_name,
    COUNT(DISTINCT ai.product_id) AS total_products,
    COALESCE(SUM(ai.quantity), 0) AS total_stock
FROM users u
LEFT JOIN admin_inventory ai ON u.id = ai.admin_id
WHERE u.role = 'admin'
GROUP BY u.id, u.name;
`,
  v_sales_summary: `
CREATE OR REPLACE VIEW v_sales_summary AS
SELECT
    type,
    payment_status,
    COUNT(*) AS sale_count,
    SUM(total_quantity) AS total_quantity,
    SUM(total_amount) AS total_revenue,
    SUM(subtotal) AS total_subtotal
FROM sales
GROUP BY type, payment_status;
`,
  v_sale_items_expanded: `
CREATE OR REPLACE VIEW v_sale_items_expanded AS
SELECT
    s.id AS sale_id,
    s.customer_name,
    s.type,
    s.payment_status,
    si.product_name,
    si.model,
    si.quantity,
    si.unit_price,
    si.line_total,
    si.gst_rate
FROM sales s
JOIN sale_items si ON s.id = si.sale_id;
`,
};

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const decimal = { type: Sequelize.DECIMAL(12, 3) };

    for (const viewName of Object.keys(VIEWS_TO_RECREATE)) {
      await queryInterface.sequelize.query(`DROP VIEW IF EXISTS ${viewName};`);
    }

    await queryInterface.changeColumn('sale_items', 'quantity', {
      ...decimal,
      allowNull: false,
    });

    await queryInterface.changeColumn('sales', 'total_quantity', {
      ...decimal,
      allowNull: false,
    });

    await queryInterface.changeColumn('products', 'quantity', {
      ...decimal,
      allowNull: false,
      defaultValue: 0,
    });

    await queryInterface.changeColumn('admin_inventory', 'quantity', {
      ...decimal,
      allowNull: false,
      defaultValue: 0,
    });

    await queryInterface.changeColumn('inventory_transactions', 'quantity', {
      ...decimal,
      allowNull: false,
    });

    for (const sql of Object.values(VIEWS_TO_RECREATE)) {
      await queryInterface.sequelize.query(sql);
    }
  },

  async down(queryInterface, Sequelize) {
    for (const viewName of Object.keys(VIEWS_TO_RECREATE)) {
      await queryInterface.sequelize.query(`DROP VIEW IF EXISTS ${viewName};`);
    }

    await queryInterface.changeColumn('sale_items', 'quantity', {
      type: Sequelize.INTEGER,
      allowNull: false,
    });

    await queryInterface.changeColumn('sales', 'total_quantity', {
      type: Sequelize.INTEGER,
      allowNull: false,
    });

    await queryInterface.changeColumn('products', 'quantity', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });

    await queryInterface.changeColumn('admin_inventory', 'quantity', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });

    await queryInterface.changeColumn('inventory_transactions', 'quantity', {
      type: Sequelize.INTEGER,
      allowNull: false,
    });

    for (const sql of Object.values(VIEWS_TO_RECREATE)) {
      await queryInterface.sequelize.query(sql);
    }
  },
};
