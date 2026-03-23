"use strict";
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("quotation_documents", "compliantPanNumber", {
      type: Sequelize.STRING(20),
      allowNull: true
    });
    await queryInterface.addColumn("quotation_documents", "compliantPanImage", {
      type: Sequelize.STRING(255),
      allowNull: true
    });
    await queryInterface.addColumn("quotation_documents", "compliantBankAccountNumber", {
      type: Sequelize.STRING(50),
      allowNull: true
    });
    await queryInterface.addColumn("quotation_documents", "compliantBankIfsc", {
      type: Sequelize.STRING(20),
      allowNull: true
    });
    await queryInterface.addColumn("quotation_documents", "compliantBankName", {
      type: Sequelize.STRING(100),
      allowNull: true
    });
    await queryInterface.addColumn("quotation_documents", "compliantBankBranch", {
      type: Sequelize.STRING(100),
      allowNull: true
    });
    await queryInterface.addColumn("quotation_documents", "compliantBankPassbookImage", {
      type: Sequelize.STRING(255),
      allowNull: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("quotation_documents", "compliantBankPassbookImage");
    await queryInterface.removeColumn("quotation_documents", "compliantBankBranch");
    await queryInterface.removeColumn("quotation_documents", "compliantBankName");
    await queryInterface.removeColumn("quotation_documents", "compliantBankIfsc");
    await queryInterface.removeColumn("quotation_documents", "compliantBankAccountNumber");
    await queryInterface.removeColumn("quotation_documents", "compliantPanImage");
    await queryInterface.removeColumn("quotation_documents", "compliantPanNumber");
  }
};
