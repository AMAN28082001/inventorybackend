'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();

    // Add `hr` role to users role constraints/enum.
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
        ALTER TABLE users ADD CONSTRAINT users_role_check
        CHECK (role IN ('super-admin', 'super-admin-manager', 'admin', 'agent', 'account', 'installer', 'baldev', 'confirmation', 'hr'));
      `);
    } else {
      await queryInterface.sequelize.query(`
        ALTER TABLE users
        MODIFY COLUMN role ENUM(
          'super-admin',
          'super-admin-manager',
          'admin',
          'agent',
          'account',
          'installer',
          'baldev',
          'confirmation',
          'hr'
        ) NOT NULL
      `);
    }

    await queryInterface.createTable('calling_leads', {
      id: {
        type: Sequelize.STRING(50),
        allowNull: false,
        primaryKey: true
      },
      name: {
        type: Sequelize.STRING(150),
        allowNull: false
      },
      mobile: {
        type: Sequelize.STRING(20),
        allowNull: false,
        unique: true
      },
      altMobile: {
        type: Sequelize.STRING(20),
        allowNull: true
      },
      city: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      state: {
        type: Sequelize.STRING(100),
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

    await queryInterface.createTable('dealer_lead_assignments', {
      id: {
        type: Sequelize.STRING(50),
        allowNull: false,
        primaryKey: true
      },
      leadId: {
        type: Sequelize.STRING(50),
        allowNull: false,
        unique: true,
        references: {
          model: 'calling_leads',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      dealerId: {
        type: Sequelize.STRING(50),
        allowNull: false,
        references: {
          model: 'dealers',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
      },
      assignedBy: {
        type: Sequelize.STRING(50),
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
      },
      assignedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      status: {
        type: Sequelize.ENUM('assigned', 'in_progress', 'completed'),
        allowNull: false,
        defaultValue: 'assigned'
      },
      action: {
        type: Sequelize.ENUM('called', 'follow_up', 'not_interested'),
        allowNull: true
      },
      actionAt: {
        type: Sequelize.DATE,
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

    await queryInterface.addIndex('calling_leads', ['mobile'], {
      name: 'idx_calling_leads_mobile',
      unique: true
    });
    await queryInterface.addIndex('dealer_lead_assignments', ['leadId'], {
      name: 'idx_dealer_lead_assignments_lead_id',
      unique: true
    });
    await queryInterface.addIndex('dealer_lead_assignments', ['dealerId', 'status', 'assignedAt'], {
      name: 'idx_dealer_lead_assignments_dealer_status_assigned_at'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('dealer_lead_assignments', 'idx_dealer_lead_assignments_dealer_status_assigned_at');
    await queryInterface.removeIndex('dealer_lead_assignments', 'idx_dealer_lead_assignments_lead_id');
    await queryInterface.removeIndex('calling_leads', 'idx_calling_leads_mobile');
    await queryInterface.dropTable('dealer_lead_assignments');
    await queryInterface.dropTable('calling_leads');

    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
        ALTER TABLE users ADD CONSTRAINT users_role_check
        CHECK (role IN ('super-admin', 'super-admin-manager', 'admin', 'agent', 'account', 'installer', 'baldev', 'confirmation'));
      `);
    } else {
      await queryInterface.sequelize.query(`
        ALTER TABLE users
        MODIFY COLUMN role ENUM(
          'super-admin',
          'super-admin-manager',
          'admin',
          'agent',
          'account',
          'installer',
          'baldev',
          'confirmation'
        ) NOT NULL
      `);
    }
  }
};
