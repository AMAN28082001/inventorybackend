import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

type InstallationDocType =
  | 'installer_po'
  | 'installer_pi'
  | 'additional_expense'
  | 'site_completion_image'
  | 'warranty_doc'
  | 'meter_doc'
  | 'other';

interface QuotationInstallationDocAttributes {
  id: string;
  quotationId: string;
  docType: InstallationDocType;
  fileUrl: string;
  uploadedByUserId: string;
  uploadedByRole: string;
  remarks?: string | null;
  metadata?: object | null;
  uploadedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

interface QuotationInstallationDocCreationAttributes extends Optional<
  QuotationInstallationDocAttributes,
  'id' | 'remarks' | 'metadata' | 'uploadedAt' | 'createdAt' | 'updatedAt'
> {}

class QuotationInstallationDoc
  extends Model<QuotationInstallationDocAttributes, QuotationInstallationDocCreationAttributes>
  implements QuotationInstallationDocAttributes
{
  public id!: string;
  public quotationId!: string;
  public docType!: InstallationDocType;
  public fileUrl!: string;
  public uploadedByUserId!: string;
  public uploadedByRole!: string;
  public remarks!: string | null;
  public metadata!: object | null;
  public uploadedAt!: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

QuotationInstallationDoc.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
    },
    quotationId: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    docType: {
      type: DataTypes.ENUM(
        'installer_po',
        'installer_pi',
        'additional_expense',
        'site_completion_image',
        'warranty_doc',
        'meter_doc',
        'other'
      ),
      allowNull: false
    },
    fileUrl: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    uploadedByUserId: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    uploadedByRole: {
      type: DataTypes.STRING(40),
      allowNull: false
    },
    remarks: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    uploadedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  {
    sequelize,
    tableName: 'quotation_installation_docs',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    freezeTableName: true,
    underscored: false,
    indexes: [
      { fields: ['quotationId'] },
      { fields: ['docType'] },
      { fields: ['uploadedAt'] }
    ]
  }
);

export default QuotationInstallationDoc;
