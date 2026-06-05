import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface QuotationDocumentAttributes {
  id: string;
  quotationId: string;
  aadharNumber?: string | null;
  aadharFront?: string | null;
  aadharBack?: string | null;
  phoneNumber?: string | null;
  emailId?: string | null;
  panNumber?: string | null;
  panImage?: string | null;
  electricityKno?: string | null;
  electricityBillImage?: string | null;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
  bankName?: string | null;
  bankBranch?: string | null;
  bankPassbookImage?: string | null;
  geotagRoofPhoto?: string | null;
  customerWithHousePhoto?: string | null;
  propertyDocumentPdf?: string | null;
  isCompliantSenior?: boolean | null;
  compliantAadharNumber?: string | null;
  compliantAadharFront?: string | null;
  compliantAadharBack?: string | null;
  compliantContactPhone?: string | null;
  compliantPanNumber?: string | null;
  compliantPanImage?: string | null;
  compliantBankAccountNumber?: string | null;
  compliantBankIfsc?: string | null;
  compliantBankName?: string | null;
  compliantBankBranch?: string | null;
  compliantBankPassbookImage?: string | null;
  customerFinalBillFile?: string | null;
  panelWarrantyFile?: string | null;
  inverterWarrantyFile?: string | null;
  workCompletionWarrantyFile?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface QuotationDocumentCreationAttributes extends Optional<
  QuotationDocumentAttributes,
  | 'id'
  | 'aadharNumber'
  | 'aadharFront'
  | 'aadharBack'
  | 'phoneNumber'
  | 'emailId'
  | 'panNumber'
  | 'panImage'
  | 'electricityKno'
  | 'electricityBillImage'
  | 'bankAccountNumber'
  | 'bankIfsc'
  | 'bankName'
  | 'bankBranch'
  | 'bankPassbookImage'
  | 'geotagRoofPhoto'
  | 'customerWithHousePhoto'
  | 'propertyDocumentPdf'
  | 'isCompliantSenior'
  | 'compliantAadharNumber'
  | 'compliantAadharFront'
  | 'compliantAadharBack'
  | 'compliantContactPhone'
  | 'compliantPanNumber'
  | 'compliantPanImage'
  | 'compliantBankAccountNumber'
  | 'compliantBankIfsc'
  | 'compliantBankName'
  | 'compliantBankBranch'
  | 'compliantBankPassbookImage'
  | 'customerFinalBillFile'
  | 'panelWarrantyFile'
  | 'inverterWarrantyFile'
  | 'workCompletionWarrantyFile'
  | 'createdAt'
  | 'updatedAt'
> {}

class QuotationDocument
  extends Model<QuotationDocumentAttributes, QuotationDocumentCreationAttributes>
  implements QuotationDocumentAttributes
{
  public id!: string;
  public quotationId!: string;
  public aadharNumber!: string | null;
  public aadharFront!: string | null;
  public aadharBack!: string | null;
  public phoneNumber!: string | null;
  public emailId!: string | null;
  public panNumber!: string | null;
  public panImage!: string | null;
  public electricityKno!: string | null;
  public electricityBillImage!: string | null;
  public bankAccountNumber!: string | null;
  public bankIfsc!: string | null;
  public bankName!: string | null;
  public bankBranch!: string | null;
  public bankPassbookImage!: string | null;
  public geotagRoofPhoto!: string | null;
  public customerWithHousePhoto!: string | null;
  public propertyDocumentPdf!: string | null;
  public isCompliantSenior!: boolean | null;
  public compliantAadharNumber!: string | null;
  public compliantAadharFront!: string | null;
  public compliantAadharBack!: string | null;
  public compliantContactPhone!: string | null;
  public compliantPanNumber!: string | null;
  public compliantPanImage!: string | null;
  public compliantBankAccountNumber!: string | null;
  public compliantBankIfsc!: string | null;
  public compliantBankName!: string | null;
  public compliantBankBranch!: string | null;
  public compliantBankPassbookImage!: string | null;
  public customerFinalBillFile!: string | null;
  public panelWarrantyFile!: string | null;
  public inverterWarrantyFile!: string | null;
  public workCompletionWarrantyFile!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

QuotationDocument.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
    },
    quotationId: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true
    },
    aadharNumber: { type: DataTypes.STRING(50), allowNull: true },
    aadharFront: { type: DataTypes.STRING(255), allowNull: true },
    aadharBack: { type: DataTypes.STRING(255), allowNull: true },
    phoneNumber: { type: DataTypes.STRING(20), allowNull: true },
    emailId: { type: DataTypes.STRING(255), allowNull: true },
    panNumber: { type: DataTypes.STRING(20), allowNull: true },
    panImage: { type: DataTypes.STRING(255), allowNull: true },
    electricityKno: { type: DataTypes.STRING(50), allowNull: true },
    electricityBillImage: { type: DataTypes.STRING(255), allowNull: true },
    bankAccountNumber: { type: DataTypes.STRING(50), allowNull: true },
    bankIfsc: { type: DataTypes.STRING(20), allowNull: true },
    bankName: { type: DataTypes.STRING(100), allowNull: true },
    bankBranch: { type: DataTypes.STRING(100), allowNull: true },
    bankPassbookImage: { type: DataTypes.STRING(255), allowNull: true },
    geotagRoofPhoto: { type: DataTypes.STRING(255), allowNull: true },
    customerWithHousePhoto: { type: DataTypes.STRING(255), allowNull: true },
    propertyDocumentPdf: { type: DataTypes.STRING(255), allowNull: true },
    isCompliantSenior: { type: DataTypes.BOOLEAN, allowNull: true },
    compliantAadharNumber: { type: DataTypes.STRING(50), allowNull: true },
    compliantAadharFront: { type: DataTypes.STRING(255), allowNull: true },
    compliantAadharBack: { type: DataTypes.STRING(255), allowNull: true },
    compliantContactPhone: { type: DataTypes.STRING(20), allowNull: true },
    compliantPanNumber: { type: DataTypes.STRING(20), allowNull: true },
    compliantPanImage: { type: DataTypes.STRING(255), allowNull: true },
    compliantBankAccountNumber: { type: DataTypes.STRING(50), allowNull: true },
    compliantBankIfsc: { type: DataTypes.STRING(20), allowNull: true },
    compliantBankName: { type: DataTypes.STRING(100), allowNull: true },
    compliantBankBranch: { type: DataTypes.STRING(100), allowNull: true },
    compliantBankPassbookImage: { type: DataTypes.STRING(255), allowNull: true },
    customerFinalBillFile: { type: DataTypes.STRING(255), allowNull: true },
    panelWarrantyFile: { type: DataTypes.STRING(255), allowNull: true },
    inverterWarrantyFile: { type: DataTypes.STRING(255), allowNull: true },
    workCompletionWarrantyFile: { type: DataTypes.STRING(255), allowNull: true }
  },
  {
    sequelize,
    tableName: 'quotation_documents',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    freezeTableName: true,
    underscored: false,
    indexes: [{ fields: ['quotationId'] }]
  }
);

export default QuotationDocument;
