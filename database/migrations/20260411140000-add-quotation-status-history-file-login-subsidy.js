'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('quotations', 'subsidyChequeDetails', {
      type: Sequelize.TEXT,
      allowNull: true
    });
    await queryInterface.addColumn('quotations', 'fileLoginStatus', {
      type: Sequelize.STRING(32),
      allowNull: true
    });
    await queryInterface.addColumn('quotations', 'filePaymentType', {
      type: Sequelize.STRING(16),
      allowNull: true
    });
    await queryInterface.addColumn('quotations', 'fileBankName', {
      type: Sequelize.STRING(255),
      allowNull: true
    });
    await queryInterface.addColumn('quotations', 'fileBankIfsc', {
      type: Sequelize.STRING(11),
      allowNull: true
    });
    await queryInterface.addColumn('quotations', 'fileSubsidyChequeDetails', {
      type: Sequelize.TEXT,
      allowNull: true
    });
    await queryInterface.addColumn('quotations', 'fileLoginAt', {
      type: Sequelize.DATE,
      allowNull: true
    });
    await queryInterface.addColumn('quotations', 'statusApprovedAt', {
      type: Sequelize.DATE,
      allowNull: true
    });
    await queryInterface.addColumn('quotations', 'statusHistory', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: []
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('quotations', 'statusHistory');
    await queryInterface.removeColumn('quotations', 'statusApprovedAt');
    await queryInterface.removeColumn('quotations', 'fileLoginAt');
    await queryInterface.removeColumn('quotations', 'fileSubsidyChequeDetails');
    await queryInterface.removeColumn('quotations', 'fileBankIfsc');
    await queryInterface.removeColumn('quotations', 'fileBankName');
    await queryInterface.removeColumn('quotations', 'filePaymentType');
    await queryInterface.removeColumn('quotations', 'fileLoginStatus');
    await queryInterface.removeColumn('quotations', 'subsidyChequeDetails');
  }
};
