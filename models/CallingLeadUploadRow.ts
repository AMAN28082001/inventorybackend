import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

type CallingLeadUploadRowStatus = 'created' | 'duplicate' | 'invalid';

interface CallingLeadUploadRowAttributes {
  id: string;
  batchId: string;
  rowIndex: number;
  customerName?: string | null;
  customerMobile?: string | null;
  customerAddress?: string | null;
  status: CallingLeadUploadRowStatus;
  leadId?: string | null;
  rawPayload?: object | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface CallingLeadUploadRowCreationAttributes extends Optional<
  CallingLeadUploadRowAttributes,
  'id' | 'customerName' | 'customerMobile' | 'customerAddress' | 'leadId' | 'rawPayload' | 'createdAt' | 'updatedAt'
> {}

class CallingLeadUploadRow
  extends Model<CallingLeadUploadRowAttributes, CallingLeadUploadRowCreationAttributes>
  implements CallingLeadUploadRowAttributes {
  public id!: string;
  public batchId!: string;
  public rowIndex!: number;
  public customerName!: string | null;
  public customerMobile!: string | null;
  public customerAddress!: string | null;
  public status!: CallingLeadUploadRowStatus;
  public leadId!: string | null;
  public rawPayload!: object | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

CallingLeadUploadRow.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
    },
    batchId: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    rowIndex: {
      type: DataTypes.INTEGER,
      allowNull: false
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
    },
    status: {
      type: DataTypes.ENUM('created', 'duplicate', 'invalid'),
      allowNull: false
    },
    leadId: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    rawPayload: {
      type: DataTypes.JSONB,
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'calling_lead_upload_rows',
    timestamps: true,
    freezeTableName: true,
    underscored: false,
    indexes: [
      { fields: ['batchId', 'rowIndex'] },
      { fields: ['status'] }
    ]
  }
);

export default CallingLeadUploadRow;
