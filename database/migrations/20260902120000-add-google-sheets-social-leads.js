'use strict';

/** Google Sheets → HR Social Media leads. See BACKEND_GOOGLE_SHEETS_SOCIAL_LEADS.ts */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const jsonDefault =
      queryInterface.sequelize.getDialect() === 'postgres' ? `'[]'::jsonb` : "'[]'";

    await queryInterface.createTable('calling_lead_sheet_sources', {
      id: {
        type: Sequelize.STRING(50),
        allowNull: false,
        primaryKey: true
      },
      spreadsheetId: {
        type: Sequelize.STRING(128),
        allowNull: false
      },
      sheetTabName: {
        type: Sequelize.STRING(128),
        allowNull: false
      },
      displayName: {
        type: Sequelize.STRING(256),
        allowNull: false
      },
      enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      dealerIds: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: Sequelize.literal(jsonDefault)
      },
      activeLimitPerDealer: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1
      },
      lastSyncedRow: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1
      },
      lastSyncedAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      lastSyncStatus: {
        type: Sequelize.STRING(32),
        allowNull: true
      },
      lastSyncError: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      uploadId: {
        type: Sequelize.STRING(50),
        allowNull: true,
        references: {
          model: 'calling_lead_upload_batches',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
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

    await queryInterface.addConstraint('calling_lead_sheet_sources', {
      fields: ['spreadsheetId', 'sheetTabName'],
      type: 'unique',
      name: 'uq_calling_lead_sheet_sources_spreadsheet_tab'
    });

    await queryInterface.addIndex('calling_lead_sheet_sources', ['enabled'], {
      name: 'idx_calling_lead_sheet_sources_enabled'
    });

    await queryInterface.addColumn('calling_lead_upload_batches', 'sourceType', {
      type: Sequelize.STRING(32),
      allowNull: false,
      defaultValue: 'csv'
    });
    await queryInterface.addColumn('calling_lead_upload_batches', 'sourceSheetTab', {
      type: Sequelize.STRING(128),
      allowNull: true
    });

    const leadCols = [
      ['sheetSourceId', Sequelize.STRING(50)],
      ['externalId', Sequelize.STRING(128)],
      ['sheetRowIndex', Sequelize.INTEGER],
      ['platform', Sequelize.STRING(64)],
      ['campaignName', Sequelize.STRING(256)],
      ['adName', Sequelize.STRING(256)],
      ['sheetLeadStatus', Sequelize.STRING(64)],
      ['remarks', Sequelize.TEXT],
      ['remarks2', Sequelize.TEXT],
      ['assignedPersonName', Sequelize.STRING(128)],
      ['firstCallResponse', Sequelize.TEXT],
      ['secondCallResponse', Sequelize.TEXT],
      ['loginFlag', Sequelize.BOOLEAN],
      ['finalDecision', Sequelize.STRING(128)],
      ['finalDecisionReason', Sequelize.TEXT],
      ['sheetCreatedTime', Sequelize.DATE]
    ];

    for (const [name, type] of leadCols) {
      await queryInterface.addColumn('calling_leads', name, {
        type,
        allowNull: true
      });
    }

    await queryInterface.addIndex('calling_leads', ['sheetSourceId'], {
      name: 'idx_calling_leads_sheet_source_id'
    });
    await queryInterface.addIndex('calling_leads', ['batchId', 'mobileNormalized'], {
      name: 'idx_calling_leads_batch_mobile'
    });

    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_calling_leads_sheet_external
        ON "calling_leads" ("sheetSourceId", "externalId")
        WHERE "externalId" IS NOT NULL AND TRIM("externalId") <> '';
      `);
    }
  },

  async down(queryInterface) {
    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_calling_leads_sheet_external;');
    }
    await queryInterface.removeIndex('calling_leads', 'idx_calling_leads_batch_mobile');
    await queryInterface.removeIndex('calling_leads', 'idx_calling_leads_sheet_source_id');

    const leadCols = [
      'sheetCreatedTime',
      'finalDecisionReason',
      'finalDecision',
      'loginFlag',
      'secondCallResponse',
      'firstCallResponse',
      'assignedPersonName',
      'remarks2',
      'remarks',
      'sheetLeadStatus',
      'adName',
      'campaignName',
      'platform',
      'sheetRowIndex',
      'externalId',
      'sheetSourceId'
    ];
    for (const col of leadCols) {
      await queryInterface.removeColumn('calling_leads', col);
    }

    await queryInterface.removeColumn('calling_lead_upload_batches', 'sourceSheetTab');
    await queryInterface.removeColumn('calling_lead_upload_batches', 'sourceType');
    await queryInterface.dropTable('calling_lead_sheet_sources');
  }
};
