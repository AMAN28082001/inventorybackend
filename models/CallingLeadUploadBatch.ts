import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface CallingLeadUploadBatchAttributes {
  id: string;
  fileName: string;
  uploadedBy: string;
  uploadedAt: Date;
  rowCount: number;
  assignedDealers: string[];
  sourceType?: string;
  sourceSheetTab?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface CallingLeadUploadBatchCreationAttributes extends Optional<
  CallingLeadUploadBatchAttributes,
  'id' | 'uploadedAt' | 'sourceType' | 'sourceSheetTab' | 'createdAt' | 'updatedAt'
> {}

class CallingLeadUploadBatch
  extends Model<CallingLeadUploadBatchAttributes, CallingLeadUploadBatchCreationAttributes>
  implements CallingLeadUploadBatchAttributes {
  public id!: string;
  public fileName!: string;
  public uploadedBy!: string;
  public uploadedAt!: Date;
  public rowCount!: number;
  public assignedDealers!: string[];
  public sourceType!: string;
  public sourceSheetTab!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

CallingLeadUploadBatch.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
    },
    fileName: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    uploadedBy: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    uploadedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    rowCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    assignedDealers: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    },
    sourceType: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'csv'
    },
    sourceSheetTab: {
      type: DataTypes.STRING(128),
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'calling_lead_upload_batches',
    timestamps: true,
    freezeTableName: true,
    underscored: false,
    indexes: [
      { fields: ['uploadedAt'] },
      { fields: ['uploadedBy'] }
    ]
  }
);

export default CallingLeadUploadBatch;
