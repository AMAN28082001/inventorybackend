import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

type CallingActionType = 'called' | 'follow_up' | 'not_interested' | 'rescheduled';
type ReasonCategory = 'interested' | 'follow_up' | 'not_interested' | 'others';

interface CallingActionHistoryAttributes {
  id: string;
  leadId: string;
  dealerId: string;
  dealerName?: string | null;
  action: CallingActionType;
  reasonCategory?: ReasonCategory | null;
  callRemark?: string | null;
  statusCategory?: string | null;
  statusLabel?: string | null;
  statusReason?: string | null;
  isCustomReason?: boolean;
  actionAt: Date;
  nextFollowUpAt?: Date | null;
  customerName?: string | null;
  customerMobile?: string | null;
  customerAddress?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface CallingActionHistoryCreationAttributes extends Optional<
  CallingActionHistoryAttributes,
  | 'id'
  | 'callRemark'
  | 'statusCategory'
  | 'statusLabel'
  | 'statusReason'
  | 'isCustomReason'
  | 'nextFollowUpAt'
  | 'createdAt'
  | 'updatedAt'
> {}

class CallingActionHistory
  extends Model<CallingActionHistoryAttributes, CallingActionHistoryCreationAttributes>
  implements CallingActionHistoryAttributes {
  public id!: string;
  public leadId!: string;
  public dealerId!: string;
  public dealerName!: string | null;
  public action!: CallingActionType;
  public reasonCategory!: ReasonCategory | null;
  public callRemark!: string | null;
  public statusCategory!: string | null;
  public statusLabel!: string | null;
  public statusReason!: string | null;
  public isCustomReason!: boolean;
  public actionAt!: Date;
  public nextFollowUpAt!: Date | null;
  public customerName!: string | null;
  public customerMobile!: string | null;
  public customerAddress!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

CallingActionHistory.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
    },
    leadId: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    dealerId: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    dealerName: {
      type: DataTypes.STRING(200),
      allowNull: true
    },
    action: {
      type: DataTypes.ENUM('called', 'follow_up', 'not_interested', 'rescheduled'),
      allowNull: false
    },
    reasonCategory: {
      type: DataTypes.ENUM('interested', 'follow_up', 'not_interested', 'others'),
      allowNull: true
    },
    callRemark: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    statusCategory: {
      type: DataTypes.STRING(64),
      allowNull: true
    },
    statusLabel: {
      type: DataTypes.STRING(128),
      allowNull: true
    },
    statusReason: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    isCustomReason: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    actionAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    nextFollowUpAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    customerName: {
      type: DataTypes.STRING(150),
      allowNull: true
    },
    customerMobile: {
      type: DataTypes.STRING(20),
      allowNull: true
    },
    customerAddress: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'calling_action_history',
    timestamps: true,
    freezeTableName: true,
    underscored: false,
    indexes: [
      { fields: ['actionAt'] },
      { fields: ['dealerId'] },
      { fields: ['action'] },
      { fields: ['dealerId', 'actionAt'] },
      { fields: ['statusCategory', 'statusReason', 'actionAt'] }
    ]
  }
);

export default CallingActionHistory;
