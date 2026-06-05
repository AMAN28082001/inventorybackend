'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Handle partial/previous failed runs gracefully.
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS "quotation_payment_phases_quotation_id";');

    let tableExists = true;
    try {
      await queryInterface.describeTable('quotation_payment_phases');
    } catch (_error) {
      tableExists = false;
    }

    if (!tableExists) {
      await queryInterface.createTable('quotation_payment_phases', {
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
      phaseNumber: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      phaseName: {
        type: Sequelize.STRING(120),
        allowNull: false
      },
      amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0
      },
      paidAmount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0
      },
      status: {
        type: Sequelize.ENUM('pending', 'partial', 'completed'),
        allowNull: false,
        defaultValue: 'pending'
      },
      dueDate: {
        type: Sequelize.DATE,
        allowNull: true
      },
      paymentDate: {
        type: Sequelize.DATE,
        allowNull: true
      },
      paymentMode: {
        type: Sequelize.STRING(30),
        allowNull: true
      },
      transactionId: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      updatedBy: {
        type: Sequelize.STRING(50),
        allowNull: true
      },
      updatedAtPhase: {
        type: Sequelize.DATE,
        allowNull: true
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW')
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW')
      }
      });
    }

    const existingIndexes = await queryInterface.showIndex('quotation_payment_phases');
    const existingNames = new Set(existingIndexes.map((idx) => idx.name));

    if (!existingNames.has('quotation_payment_phases_quotation_id_idx')) {
      await queryInterface.addIndex('quotation_payment_phases', ['quotationId'], {
        name: 'quotation_payment_phases_quotation_id_idx'
      });
    }
    if (!existingNames.has('quotation_payment_phases_status_idx')) {
      await queryInterface.addIndex('quotation_payment_phases', ['status'], {
        name: 'quotation_payment_phases_status_idx'
      });
    }
    if (!existingNames.has('quotation_payment_phases_payment_date_idx')) {
      await queryInterface.addIndex('quotation_payment_phases', ['paymentDate'], {
        name: 'quotation_payment_phases_payment_date_idx'
      });
    }
    if (!existingNames.has('quotation_payment_phases_quotation_phase_unique')) {
      await queryInterface.addIndex('quotation_payment_phases', ['quotationId', 'phaseNumber'], {
        unique: true,
        name: 'quotation_payment_phases_quotation_phase_unique'
      });
    }

    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        INSERT INTO quotation_payment_phases
          ("id", "quotationId", "phaseNumber", "phaseName", "amount", "paidAmount", "status", "dueDate", "paymentDate", "paymentMode", "transactionId", "updatedBy", "updatedAtPhase", "createdAt", "updatedAt")
        SELECT
          md5(random()::text || clock_timestamp()::text) AS id,
          q.id AS "quotationId",
          COALESCE((phase->>'phaseNumber')::int, 0) AS "phaseNumber",
          COALESCE(phase->>'phaseName', 'Installment') AS "phaseName",
          COALESCE((phase->>'amount')::numeric, 0) AS "amount",
          COALESCE((phase->>'paidAmount')::numeric, 0) AS "paidAmount",
          CASE
            WHEN COALESCE((phase->>'paidAmount')::numeric, 0) <= 0 THEN 'pending'
            WHEN COALESCE((phase->>'paidAmount')::numeric, 0) >= COALESCE((phase->>'amount')::numeric, 0) AND COALESCE((phase->>'amount')::numeric, 0) > 0 THEN 'completed'
            ELSE 'partial'
          END::"enum_quotation_payment_phases_status" AS "status",
          NULLIF(phase->>'dueDate', '')::timestamp AS "dueDate",
          NULLIF(phase->>'paymentDate', '')::timestamp AS "paymentDate",
          NULLIF(phase->>'paymentMode', '') AS "paymentMode",
          NULLIF(phase->>'transactionId', '') AS "transactionId",
          NULLIF(phase->>'updatedBy', '') AS "updatedBy",
          NULLIF(phase->>'updatedAt', '')::timestamp AS "updatedAtPhase",
          NOW() AS "createdAt",
          NOW() AS "updatedAt"
        FROM quotations q
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(q."paymentPhases", '[]'::jsonb)) AS phase
        WHERE q."paymentPhases" IS NOT NULL
        ON CONFLICT ("quotationId", "phaseNumber") DO NOTHING;
      `);
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('quotation_payment_phases', 'quotation_payment_phases_quotation_phase_unique');
    await queryInterface.removeIndex('quotation_payment_phases', 'quotation_payment_phases_payment_date_idx');
    await queryInterface.removeIndex('quotation_payment_phases', 'quotation_payment_phases_status_idx');
    await queryInterface.removeIndex('quotation_payment_phases', 'quotation_payment_phases_quotation_id_idx');
    await queryInterface.dropTable('quotation_payment_phases');
    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_quotation_payment_phases_status";');
    }
  }
};
