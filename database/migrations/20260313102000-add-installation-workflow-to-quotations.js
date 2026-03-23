'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('quotations', 'installationStatus', {
      type: Sequelize.STRING(40),
      allowNull: false,
      defaultValue: 'pending_installer'
    });

    await queryInterface.addColumn('quotations', 'installerId', {
      type: Sequelize.STRING(50),
      allowNull: true
    });

    await queryInterface.addColumn('quotations', 'installerActionAt', {
      type: Sequelize.DATE,
      allowNull: true
    });

    await queryInterface.addColumn('quotations', 'installerRemarks', {
      type: Sequelize.TEXT,
      allowNull: true
    });

    await queryInterface.addColumn('quotations', 'baldevId', {
      type: Sequelize.STRING(50),
      allowNull: true
    });

    await queryInterface.addColumn('quotations', 'baldevActionAt', {
      type: Sequelize.DATE,
      allowNull: true
    });

    await queryInterface.addColumn('quotations', 'baldevRemarks', {
      type: Sequelize.TEXT,
      allowNull: true
    });

    await queryInterface.addColumn('quotations', 'completionAt', {
      type: Sequelize.DATE,
      allowNull: true
    });

    await queryInterface.createTable('quotation_installation_docs', {
      id: {
        type: Sequelize.STRING(50),
        primaryKey: true,
        allowNull: false
      },
      quotationId: {
        type: Sequelize.STRING(50),
        allowNull: false,
        references: {
          model: 'quotations',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      docType: {
        type: Sequelize.STRING(40),
        allowNull: false
      },
      fileUrl: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      uploadedByUserId: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      uploadedByRole: {
        type: Sequelize.STRING(40),
        allowNull: false
      },
      remarks: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      uploadedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
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

    await queryInterface.addIndex('quotations', ['installationStatus'], { name: 'idx_quotations_installation_status' });
    await queryInterface.addIndex('quotations', ['installationStatus', 'createdAt'], { name: 'idx_quotations_installation_status_created' });
    await queryInterface.addIndex('quotation_installation_docs', ['quotationId'], { name: 'idx_q_install_docs_quotation' });
    await queryInterface.addIndex('quotation_installation_docs', ['docType'], { name: 'idx_q_install_docs_type' });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('quotation_installation_docs', 'idx_q_install_docs_type');
    await queryInterface.removeIndex('quotation_installation_docs', 'idx_q_install_docs_quotation');
    await queryInterface.removeIndex('quotations', 'idx_quotations_installation_status_created');
    await queryInterface.removeIndex('quotations', 'idx_quotations_installation_status');

    await queryInterface.dropTable('quotation_installation_docs');

    await queryInterface.removeColumn('quotations', 'completionAt');
    await queryInterface.removeColumn('quotations', 'baldevRemarks');
    await queryInterface.removeColumn('quotations', 'baldevActionAt');
    await queryInterface.removeColumn('quotations', 'baldevId');
    await queryInterface.removeColumn('quotations', 'installerRemarks');
    await queryInterface.removeColumn('quotations', 'installerActionAt');
    await queryInterface.removeColumn('quotations', 'installerId');
    await queryInterface.removeColumn('quotations', 'installationStatus');
  }
};
