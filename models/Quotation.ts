import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface QuotationAttributes {
  id: string;
  dealerId: string;
  customerId: string;
  systemType: 'on-grid' | 'off-grid' | 'hybrid' | 'dcr' | 'non-dcr' | 'both' | 'customize';
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  discount: number;
  subtotal: number;        // Set price (complete package price)
  totalAmount: number;     // Amount after discount (Subtotal - Subsidy - Discount)
  finalAmount: number;     // Final amount (Subtotal - Subsidy, discount NOT applied)
  centralSubsidy: number;  // Central government subsidy
  stateSubsidy: number;    // State subsidy
  totalSubsidy: number;    // Total subsidy (central + state)
  amountAfterSubsidy: number; // Amount after subsidy
  discountAmount: number;  // Discount amount
  paymentMode?: 'cash' | 'upi' | 'loan' | 'netbanking' | 'bank_transfer' | 'cheque' | 'card' | 'mix' | null;
  paymentType?: 'loan' | 'cash' | 'mix' | null;
  bankName?: string | null;
  bankIfsc?: string | null;
  subsidyChequeDetails?: string | null;
  fileLoginStatus?: string | null;
  filePaymentType?: string | null;
  fileBankName?: string | null;
  fileBankIfsc?: string | null;
  fileSubsidyChequeDetails?: string | null;
  fileLoginAt?: Date | null;
  statusApprovedAt?: Date | null;
  statusHistory?: Array<{ status: string; at: string }> | null;
  subsidyCheques?: Array<{
    id: string;
    details: string;
    amount: number;
    status: 'pending' | 'cleared';
    clearedAt?: string;
  }> | null;
  remainingAmount?: number | null;
  paidAmount?: number | null;
  paymentDate?: Date | null;
  paymentStatus?: 'pending' | 'partial' | 'completed' | null;
  paymentPhases?: Array<{
    phaseNumber: number;
    phaseName: string;
    amount: number;
    paidAmount: number;
    status: 'pending' | 'partial' | 'completed';
    dueDate?: string | null;
    paymentDate?: string | null;
    paymentMode?: 'cash' | 'upi' | 'loan' | 'netbanking' | 'bank_transfer' | 'cheque' | 'card' | 'mix' | null;
    transactionId?: string | null;
    updatedBy?: string | null;
    updatedAt?: string | null;
  }> | null;
  paymentPlanUpdatedBy?: string | null;
  paymentPlanUpdatedAt?: Date | null;
  approvedAt?: Date | null;
  installationStatus?: 'pending_installer' | 'installer_in_progress' | 'installer_approved' | 'installer_rejected' | 'pending_baldev' | 'baldev_approved' | 'baldev_rejected' | 'completed';
  installerId?: string | null;
  installerActionAt?: Date | null;
  installerInProgressAt?: Date | null;
  installerApprovedAt?: Date | null;
  installerRemarks?: string | null;
  baldevId?: string | null;
  baldevActionAt?: Date | null;
  baldevRemarks?: string | null;
  completionAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  validUntil: Date;
}

interface QuotationCreationAttributes extends Optional<
  QuotationAttributes,
  'id' | 'status' | 'discount' | 'createdAt' | 'updatedAt' | 'centralSubsidy' | 'stateSubsidy' | 'totalSubsidy' | 'amountAfterSubsidy' | 'discountAmount' |   'paymentMode' | 'paymentType' | 'bankName' | 'bankIfsc' | 'subsidyChequeDetails' | 'fileLoginStatus' | 'filePaymentType' | 'fileBankName' | 'fileBankIfsc' | 'fileSubsidyChequeDetails' | 'fileLoginAt' | 'statusApprovedAt'   | 'statusHistory' | 'subsidyCheques' | 'remainingAmount' | 'paidAmount' | 'paymentDate' | 'paymentStatus' | 'paymentPhases' | 'paymentPlanUpdatedBy' | 'paymentPlanUpdatedAt' | 'approvedAt' | 'installationStatus' | 'installerId' | 'installerActionAt' | 'installerInProgressAt' | 'installerApprovedAt' | 'installerRemarks' | 'baldevId' | 'baldevActionAt' | 'baldevRemarks' | 'completionAt'
> {}

class Quotation extends Model<QuotationAttributes, QuotationCreationAttributes> implements QuotationAttributes {
  public id!: string;
  public dealerId!: string;
  public customerId!: string;
  public systemType!: 'on-grid' | 'off-grid' | 'hybrid' | 'dcr' | 'non-dcr' | 'both' | 'customize';
  public status!: 'pending' | 'approved' | 'rejected' | 'completed';
  public discount!: number;
  public subtotal!: number;        // Set price (complete package price)
  public totalAmount!: number;     // Amount after discount (Subtotal - Subsidy - Discount)
  public finalAmount!: number;     // Final amount (Subtotal - Subsidy, discount NOT applied)
  public centralSubsidy!: number;  // Central government subsidy
  public stateSubsidy!: number;    // State subsidy
  public totalSubsidy!: number;    // Total subsidy (central + state)
  public amountAfterSubsidy!: number; // Amount after subsidy
  public discountAmount!: number;  // Discount amount
  public paymentMode!: 'cash' | 'upi' | 'loan' | 'netbanking' | 'bank_transfer' | 'cheque' | 'card' | 'mix' | null;
  public paymentType!: 'loan' | 'cash' | 'mix' | null;
  public bankName!: string | null;
  public bankIfsc!: string | null;
  public subsidyChequeDetails!: string | null;
  public fileLoginStatus!: string | null;
  public filePaymentType!: string | null;
  public fileBankName!: string | null;
  public fileBankIfsc!: string | null;
  public fileSubsidyChequeDetails!: string | null;
  public fileLoginAt!: Date | null;
  public statusApprovedAt!: Date | null;
  public statusHistory!: Array<{ status: string; at: string }> | null;
  public subsidyCheques!: Array<{
    id: string;
    details: string;
    amount: number;
    status: 'pending' | 'cleared';
    clearedAt?: string;
  }> | null;
  public remainingAmount!: number | null;
  public paidAmount!: number | null;
  public paymentDate!: Date | null;
  public paymentStatus!: 'pending' | 'partial' | 'completed' | null;
  public paymentPhases!: Array<{
    phaseNumber: number;
    phaseName: string;
    amount: number;
    paidAmount: number;
    status: 'pending' | 'partial' | 'completed';
    dueDate?: string | null;
    paymentDate?: string | null;
    paymentMode?: 'cash' | 'upi' | 'loan' | 'netbanking' | 'bank_transfer' | 'cheque' | 'card' | null;
    transactionId?: string | null;
    updatedBy?: string | null;
    updatedAt?: string | null;
  }> | null;
  public paymentPlanUpdatedBy!: string | null;
  public paymentPlanUpdatedAt!: Date | null;
  public approvedAt!: Date | null;
  public installationStatus!: 'pending_installer' | 'installer_in_progress' | 'installer_approved' | 'installer_rejected' | 'pending_baldev' | 'baldev_approved' | 'baldev_rejected' | 'completed';
  public installerId!: string | null;
  public installerActionAt!: Date | null;
  public installerInProgressAt!: Date | null;
  public installerApprovedAt!: Date | null;
  public installerRemarks!: string | null;
  public baldevId!: string | null;
  public baldevActionAt!: Date | null;
  public baldevRemarks!: string | null;
  public completionAt!: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
  public validUntil!: Date;
}

Quotation.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
    },
    dealerId: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    customerId: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    systemType: {
      type: DataTypes.ENUM('on-grid', 'off-grid', 'hybrid', 'dcr', 'non-dcr', 'both', 'customize'),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('pending', 'approved', 'rejected', 'completed'),
      defaultValue: 'pending'
    },
    discount: {
      type: DataTypes.DECIMAL(5, 2),
      defaultValue: 0
    },
    subtotal: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0
    },
    totalAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0
    },
    finalAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false
    },
    centralSubsidy: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0
    },
    stateSubsidy: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0
    },
    totalSubsidy: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0
    },
    amountAfterSubsidy: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0
    },
    discountAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0
    },
    paymentMode: {
      type: DataTypes.STRING(30),
      allowNull: true
    },
    paymentType: {
      type: DataTypes.STRING(10),
      allowNull: true
    },
    bankName: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    bankIfsc: {
      type: DataTypes.STRING(11),
      allowNull: true
    },
    subsidyChequeDetails: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    fileLoginStatus: {
      type: DataTypes.STRING(32),
      allowNull: true
    },
    filePaymentType: {
      type: DataTypes.STRING(16),
      allowNull: true
    },
    fileBankName: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    fileBankIfsc: {
      type: DataTypes.STRING(11),
      allowNull: true
    },
    fileSubsidyChequeDetails: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    fileLoginAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    statusApprovedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    statusHistory: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: []
    },
    subsidyCheques: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: []
    },
    remainingAmount: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true
    },
    paidAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true
    },
    paymentDate: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    paymentStatus: {
      type: DataTypes.ENUM('pending', 'partial', 'completed'),
      allowNull: true,
      defaultValue: 'pending'
    },
    paymentPhases: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    paymentPlanUpdatedBy: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    paymentPlanUpdatedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    approvedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    installationStatus: {
      type: DataTypes.ENUM(
        'pending_installer',
        'installer_in_progress',
        'installer_approved',
        'installer_rejected',
        'pending_baldev',
        'baldev_approved',
        'baldev_rejected',
        'completed'
      ),
      allowNull: false,
      defaultValue: 'pending_installer'
    },
    installerId: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    installerActionAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    installerInProgressAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    installerApprovedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    installerRemarks: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    baldevId: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    baldevActionAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    baldevRemarks: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    completionAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    validUntil: {
      type: DataTypes.DATEONLY,
      allowNull: false
    }
  },
  {
    sequelize,
    tableName: 'quotations',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    freezeTableName: true,
    underscored: false,
    indexes: [
      { fields: ['dealerId'] },
      { fields: ['customerId'] },
      { fields: ['status'] },
      { fields: ['createdAt'] },
      { fields: ['dealerId', 'status'] },
      { fields: ['createdAt', 'status'] },
      { fields: ['installationStatus'] },
      { fields: ['installationStatus', 'createdAt'] }
    ]
  }
);

export default Quotation;


