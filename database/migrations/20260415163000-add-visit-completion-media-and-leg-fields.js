'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('visits');

    if (!table.rowDiagramImage) {
      await queryInterface.addColumn('visits', 'rowDiagramImage', {
        type: Sequelize.STRING(1000),
        allowNull: true
      });
    }

    if (!table.unit) {
      await queryInterface.addColumn('visits', 'unit', {
        type: Sequelize.ENUM('feet', 'cm'),
        allowNull: true
      });
    }

    if (!table.backLegFeet) {
      await queryInterface.addColumn('visits', 'backLegFeet', {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
      });
    }

    if (!table.midLegFeet) {
      await queryInterface.addColumn('visits', 'midLegFeet', {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
      });
    }

    if (!table.frontLegFeet) {
      await queryInterface.addColumn('visits', 'frontLegFeet', {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('visits');

    if (table.frontLegFeet) {
      await queryInterface.removeColumn('visits', 'frontLegFeet');
    }
    if (table.midLegFeet) {
      await queryInterface.removeColumn('visits', 'midLegFeet');
    }
    if (table.backLegFeet) {
      await queryInterface.removeColumn('visits', 'backLegFeet');
    }
    if (table.unit) {
      await queryInterface.removeColumn('visits', 'unit');
    }
    if (table.rowDiagramImage) {
      await queryInterface.removeColumn('visits', 'rowDiagramImage');
    }
  }
};
