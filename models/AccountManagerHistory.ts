import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface AccountManagerHistoryAttributes {
  id: string;
  accountManagerId: string;
  action: string;
  details?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  timestamp?: Date;
}

interface AccountManagerHistoryCreationAttributes extends Optional<AccountManagerHistoryAttributes, 'id' | 'details' | 'ipAddress' | 'userAgent' | 'timestamp'> {}

class AccountManagerHistory extends Model<AccountManagerHistoryAttributes, AccountManagerHistoryCreationAttributes> implements AccountManagerHistoryAttributes {
  public id!: string;
  public accountManagerId!: string;
  public action!: string;
  public details!: string | null;
  public ipAddress!: string | null;
  public userAgent!: string | null;
  public readonly timestamp!: Date;
}

AccountManagerHistory.init(
  {
    id: {
      type: DataTypes.STRING(255),
      primaryKey: true
    },
    accountManagerId: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    action: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    details: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    ipAddress: {
      type: DataTypes.STRING(45),
      allowNull: true
    },
    userAgent: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    timestamp: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      allowNull: false
    }
  },
  {
    sequelize,
    tableName: 'account_manager_history',
    timestamps: false,
    freezeTableName: true,
    underscored: false,
    indexes: [
      { fields: ['accountManagerId'] },
      { fields: ['action'] },
      { fields: ['timestamp'] }
    ]
  }
);

export default AccountManagerHistory;
