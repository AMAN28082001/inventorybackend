import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface CallingLeadSheetSourceAttributes {
  id: string;
  spreadsheetId: string;
  sheetTabName: string;
  displayName: string;
  enabled: boolean;
  dealerIds: string[];
  activeLimitPerDealer: number;
  lastSyncedRow: number;
  lastSyncedAt?: Date | null;
  lastSyncStatus?: string | null;
  lastSyncError?: string | null;
  uploadId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface CallingLeadSheetSourceCreationAttributes extends Optional<
  CallingLeadSheetSourceAttributes,
  | 'id'
  | 'enabled'
  | 'dealerIds'
  | 'activeLimitPerDealer'
  | 'lastSyncedRow'
  | 'lastSyncedAt'
  | 'lastSyncStatus'
  | 'lastSyncError'
  | 'uploadId'
  | 'createdAt'
  | 'updatedAt'
> {}

class CallingLeadSheetSource
  extends Model<CallingLeadSheetSourceAttributes, CallingLeadSheetSourceCreationAttributes>
  implements CallingLeadSheetSourceAttributes
{
  public id!: string;
  public spreadsheetId!: string;
  public sheetTabName!: string;
  public displayName!: string;
  public enabled!: boolean;
  public dealerIds!: string[];
  public activeLimitPerDealer!: number;
  public lastSyncedRow!: number;
  public lastSyncedAt!: Date | null;
  public lastSyncStatus!: string | null;
  public lastSyncError!: string | null;
  public uploadId!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

CallingLeadSheetSource.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
    },
    spreadsheetId: {
      type: DataTypes.STRING(128),
      allowNull: false
    },
    sheetTabName: {
      type: DataTypes.STRING(128),
      allowNull: false
    },
    displayName: {
      type: DataTypes.STRING(256),
      allowNull: false
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    dealerIds: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    },
    activeLimitPerDealer: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1
    },
    lastSyncedRow: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1
    },
    lastSyncedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    lastSyncStatus: {
      type: DataTypes.STRING(32),
      allowNull: true
    },
    lastSyncError: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    uploadId: {
      type: DataTypes.STRING(50),
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'calling_lead_sheet_sources',
    timestamps: true,
    freezeTableName: true,
    underscored: false,
    indexes: [
      { fields: ['spreadsheetId', 'sheetTabName'], unique: true },
      { fields: ['enabled'] }
    ]
  }
);

export default CallingLeadSheetSource;
