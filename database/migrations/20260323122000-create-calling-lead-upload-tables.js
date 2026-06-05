'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('calling_leads', 'batchId', {
      type: Sequelize.STRING(50),
      allowNull: true
    });
    await queryInterface.addIndex('calling_leads', ['batchId'], {
      name: 'idx_calling_leads_batch_id'
    });

    await queryInterface.createTable('calling_lead_upload_batches', {
      id: {
        type: Sequelize.STRING(50),
        allowNull: false,
        primaryKey: true
      },
      fileName: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      uploadedBy: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      uploadedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      rowCount: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      assignedDealers: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: Sequelize.literal(dialectJsonDefault(queryInterface))
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

    await queryInterface.createTable('calling_lead_upload_rows', {
      id: {
        type: Sequelize.STRING(50),
        allowNull: false,
        primaryKey: true
      },
      batchId: {
        type: Sequelize.STRING(50),
        allowNull: false,
        references: {
          model: 'calling_lead_upload_batches',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      rowIndex: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      customerName: {
        type: Sequelize.STRING(150),
        allowNull: true
      },
      customerMobile: {
        type: Sequelize.STRING(20),
        allowNull: true
      },
      customerAddress: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      status: {
        type: Sequelize.ENUM('created', 'duplicate', 'invalid'),
        allowNull: false
      },
      leadId: {
        type: Sequelize.STRING(50),
        allowNull: true
      },
      rawPayload: {
        type: Sequelize.JSONB,
        allowNull: true
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

    await queryInterface.addIndex('calling_lead_upload_batches', ['uploadedAt'], {
      name: 'idx_calling_lead_upload_batches_uploaded_at'
    });
    await queryInterface.addIndex('calling_lead_upload_batches', ['uploadedBy'], {
      name: 'idx_calling_lead_upload_batches_uploaded_by'
    });
    await queryInterface.addIndex('calling_lead_upload_rows', ['batchId', 'rowIndex'], {
      name: 'idx_calling_lead_upload_rows_batch_row'
    });
    await queryInterface.addIndex('calling_lead_upload_rows', ['status'], {
      name: 'idx_calling_lead_upload_rows_status'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('calling_lead_upload_rows', 'idx_calling_lead_upload_rows_status');
    await queryInterface.removeIndex('calling_lead_upload_rows', 'idx_calling_lead_upload_rows_batch_row');
    await queryInterface.removeIndex('calling_lead_upload_batches', 'idx_calling_lead_upload_batches_uploaded_by');
    await queryInterface.removeIndex('calling_lead_upload_batches', 'idx_calling_lead_upload_batches_uploaded_at');
    await queryInterface.dropTable('calling_lead_upload_rows');
    await queryInterface.dropTable('calling_lead_upload_batches');
    await queryInterface.removeIndex('calling_leads', 'idx_calling_leads_batch_id');
    await queryInterface.removeColumn('calling_leads', 'batchId');
  }
};

function dialectJsonDefault(queryInterface) {
  return queryInterface.sequelize.getDialect() === 'postgres' ? `'[]'::jsonb` : "'[]'";
}
