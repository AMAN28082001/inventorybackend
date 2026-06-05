'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn(
      'quotation_products',
      'phase',
      {
        type: Sequelize.STRING(20),
        allowNull: true,
        comment: 'Single / Three phase'
      }
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn(
      'quotation_products',
      'phase'
    );
  }
};
