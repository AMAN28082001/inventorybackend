'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('quotation_documents', {
      id: {
        type: Sequelize.STRING(50),
        primaryKey: true,
        allowNull: false
      },
      quotationId: {
        type: Sequelize.STRING(50),
        allowNull: false,
        unique: true,
        references: {
          model: 'quotations',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      aadharNumber: { type: Sequelize.STRING(50), allowNull: true },
      aadharFront: { type: Sequelize.STRING(255), allowNull: true },
      aadharBack: { type: Sequelize.STRING(255), allowNull: true },
      phoneNumber: { type: Sequelize.STRING(20), allowNull: true },
      emailId: { type: Sequelize.STRING(255), allowNull: true },
      panNumber: { type: Sequelize.STRING(20), allowNull: true },
      panImage: { type: Sequelize.STRING(255), allowNull: true },
      electricityKno: { type: Sequelize.STRING(50), allowNull: true },
      electricityBillImage: { type: Sequelize.STRING(255), allowNull: true },
      bankAccountNumber: { type: Sequelize.STRING(50), allowNull: true },
      bankIfsc: { type: Sequelize.STRING(20), allowNull: true },
      bankName: { type: Sequelize.STRING(100), allowNull: true },
      bankBranch: { type: Sequelize.STRING(100), allowNull: true },
      bankPassbookImage: { type: Sequelize.STRING(255), allowNull: true },
      isCompliantSenior: { type: Sequelize.BOOLEAN, allowNull: true },
      compliantAadharNumber: { type: Sequelize.STRING(50), allowNull: true },
      compliantAadharFront: { type: Sequelize.STRING(255), allowNull: true },
      compliantAadharBack: { type: Sequelize.STRING(255), allowNull: true },
      compliantContactPhone: { type: Sequelize.STRING(20), allowNull: true },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('quotation_documents', ['quotationId'], { name: 'idx_quotation_documents_quotation' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('quotation_documents');
  }
};
