import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

type DealerLeadAssignmentStatus = 'queued' | 'active' | 'assigned' | 'in_progress' | 'rescheduled' | 'completed';
type DealerLeadAction = 'called' | 'follow_up' | 'not_interested' | 'rescheduled';

interface DealerLeadAssignmentAttributes {
  id: string;
  leadId: string;
  dealerId: string;
  assignedBy: string;
  assignedAt: Date;
  status: DealerLeadAssignmentStatus;
  action?: DealerLeadAction | null;
  callRemark?: string | null;
  nextFollowUpAt?: Date | null;
  actionAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface DealerLeadAssignmentCreationAttributes extends Optional<DealerLeadAssignmentAttributes, 'id' | 'assignedAt' | 'status' | 'action' | 'callRemark' | 'nextFollowUpAt' | 'actionAt' | 'createdAt' | 'updatedAt'> {}

class DealerLeadAssignment extends Model<DealerLeadAssignmentAttributes, DealerLeadAssignmentCreationAttributes> implements DealerLeadAssignmentAttributes {
  public id!: string;
  public leadId!: string;
  public dealerId!: string;
  public assignedBy!: string;
  public assignedAt!: Date;
  public status!: DealerLeadAssignmentStatus;
  public action!: DealerLeadAction | null;
  public callRemark!: string | null;
  public nextFollowUpAt!: Date | null;
  public actionAt!: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

DealerLeadAssignment.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
    },
    leadId: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true
    },
    dealerId: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    assignedBy: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    assignedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    status: {
      type: DataTypes.ENUM('queued', 'active', 'assigned', 'in_progress', 'rescheduled', 'completed'),
      allowNull: false,
      defaultValue: 'active'
    },
    action: {
      type: DataTypes.ENUM('called', 'follow_up', 'not_interested', 'rescheduled'),
      allowNull: true
    },
    callRemark: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    nextFollowUpAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    actionAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'dealer_lead_assignments',
    timestamps: true,
    freezeTableName: true,
    underscored: false,
    indexes: [
      { fields: ['leadId'], unique: true },
      { fields: ['dealerId', 'status', 'assignedAt'] },
      { fields: ['dealerId', 'status', 'nextFollowUpAt'] },
      { fields: ['assignedBy'] }
    ]
  }
);

export default DealerLeadAssignment;
