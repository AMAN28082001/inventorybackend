'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('quotation_documents', 'geotagRoofPhoto', {
      type: Sequelize.STRING(255),
      allowNull: true
    });
    await queryInterface.addColumn('quotation_documents', 'customerWithHousePhoto', {
      type: Sequelize.STRING(255),
      allowNull: true
    });
    await queryInterface.addColumn('quotation_documents', 'propertyDocumentPdf', {
      type: Sequelize.STRING(255),
      allowNull: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('quotation_documents', 'propertyDocumentPdf');
    await queryInterface.removeColumn('quotation_documents', 'customerWithHousePhoto');
    await queryInterface.removeColumn('quotation_documents', 'geotagRoofPhoto');
  }
};
