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
  /** Persisted system size (kW) from panel config — used by admin overview */
  systemKw?: number | null;
  /** §23 — prior quotation when creating an additional row for the same customer */
  sourceQuotationId?: string | null;
  /** §23 — only one current quotation per customer (Current / Previous badges) */
  isCurrent?: boolean;
  /** Optional create/revise notes (e.g. "Additional quotation revised from QT-…") */
  notes?: string | null;
  totalAmount: number;     // Amount after discount (Subtotal - Subsidy - Discount)
  finalAmount: number;     // Final amount (Subtotal - Subsidy, discount NOT applied)
  centralSubsidy: number;  // Central government subsidy
  stateSubsidy: number;    // State subsidy
  totalSubsidy: number;    // Total subsidy (central + state)
  amountAfterSubsidy: number; // Amount after subsidy
  discountAmount: number;  // Discount amount
  paymentMode?: 'cash' | 'upi' | 'loan' | 'netbanking' | 'bank_transfer' | 'cheque' | 'card' | 'mix' | null;
  paymentType?: 'loan' | 'cash' | 'mix' | null;
  loanAmount?: number | null;
  cashAmount?: number | null;
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
  /** Revise/revert stack: previous products+pricing snapshots (HANDOFF §23) */
  systemHistory?: Array<{
    products: Record<string, unknown>;
    pricing: Record<string, unknown>;
    label: string;
    savedAt: string;
    customPanels?: Array<Record<string, unknown>>;
  }> | null;
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
  finalSettlementAmount?: number | null;
  finalSettlementApplied?: boolean;
  finalSettlementAt?: Date | null;
  finalSettlementBy?: string | null;
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
  installationStatus?: 'pending_installer' | 'installer_in_progress' | 'installer_partial_approved' | 'installer_approved' | 'installer_rejected' | 'pending_baldev' | 'baldev_approved' | 'baldev_rejected' | 'pending_metering' | 'metering_in_progress' | 'metering_approved' | 'meter_installation_pending' | 'mco' | 'completed';
  installerId?: string | null;
  installerActionAt?: Date | null;
  installerInProgressAt?: Date | null;
  installerApprovedAt?: Date | null;
  installerRemarks?: string | null;
  installationPartialApproved?: boolean;
  installationPartialApprovedAt?: Date | null;
  installationReadyForInstaller?: boolean;
  installationReleasedAt?: Date | null;
  /** Admin-planned installation date (calendar day, YYYY-MM-DD) */
  installationScheduledAt?: string | null;
  /** Installation field team (see installation_teams.id) */
  installationTeamId?: string | null;
  baldevId?: string | null;
  baldevActionAt?: Date | null;
  baldevRemarks?: string | null;
  meteringId?: string | null;
  meteringActionAt?: Date | null;
  meteringApprovedAt?: Date | null;
  meteringRemarks?: string | null;
  meteringAuthorizedRepresentative?: string | null;
  discomName?: string | null;
  discomLocation?: string | null;
  meterType?: 'solar' | 'net' | 'both' | null;
  meterNo?: string | null;
  solarMeterNo?: string | null;
  netMeterNo?: string | null;
  meterDocumentImageUrl?: string | null;
  meterInstallationPendingAt?: Date | null;
  meteringWccAfterDiscom?: boolean;
  meteringWccAfterDiscomAt?: Date | null;
  /** Bank process dual-track (§17): false → Bank Process tab; true → Pending Payment */
  bankProcessDone?: boolean;
  bankProcessDoneAt?: Date | null;
  meterInstallationPhotoUrl?: string | null;
  meterInstallationPhotoName?: string | null;
  plantLivePhotoUrl?: string | null;
  plantLivePhotoName?: string | null;
  mcoAt?: Date | null;
  completionAt?: Date | null;
  /** Installer site legs (cm): back / mid / front */
  siteLengthCm?: number | null;
  siteWidthCm?: number | null;
  siteHeightCm?: number | null;
  /** Denormalized feet from installer form */
  backLegFt?: number | null;
  midLegFt?: number | null;
  frontLegFt?: number | null;
  extraExpensesTotal?: number | null;
  extraExpensesJson?: Array<{ description: string; amount: number }> | null;
  createdAt?: Date;
  updatedAt?: Date;
  validUntil: Date;
}

interface QuotationCreationAttributes extends Optional<
  QuotationAttributes,
  'id' | 'status' | 'discount' | 'createdAt' | 'updatedAt' | 'centralSubsidy' | 'stateSubsidy' | 'totalSubsidy' | 'amountAfterSubsidy' | 'discountAmount' | 'systemKw' | 'sourceQuotationId' | 'isCurrent' | 'notes' |   'paymentMode' | 'paymentType' | 'loanAmount' | 'cashAmount' | 'bankName' | 'bankIfsc' | 'subsidyChequeDetails' | 'fileLoginStatus' | 'filePaymentType' | 'fileBankName' | 'fileBankIfsc' | 'fileSubsidyChequeDetails' | 'fileLoginAt' | 'statusApprovedAt'   | 'statusHistory' | 'systemHistory' | 'subsidyCheques' | 'remainingAmount' | 'paidAmount' | 'paymentDate' | 'paymentStatus' | 'finalSettlementAmount' | 'finalSettlementApplied' | 'finalSettlementAt' | 'finalSettlementBy' | 'paymentPhases' | 'paymentPlanUpdatedBy' | 'paymentPlanUpdatedAt' | 'approvedAt' | 'installationStatus' | 'installerId' | 'installerActionAt' | 'installerInProgressAt' |   'installerApprovedAt' | 'installerRemarks' | 'installationPartialApproved' | 'installationPartialApprovedAt' | 'installationReadyForInstaller' | 'installationReleasedAt' | 'installationScheduledAt' | 'installationTeamId' |   'baldevId' | 'baldevActionAt' | 'baldevRemarks' | 'meteringId' | 'meteringActionAt' | 'meteringApprovedAt' | 'meteringRemarks' | 'meteringAuthorizedRepresentative' | 'discomName' | 'meterType' | 'meterNo' | 'solarMeterNo' | 'netMeterNo' | 'meterDocumentImageUrl' | 'mcoAt' | 'completionAt' | 'meteringWccAfterDiscom' | 'meteringWccAfterDiscomAt' | 'bankProcessDone' | 'bankProcessDoneAt' | 'siteLengthCm' | 'siteWidthCm' | 'siteHeightCm' | 'backLegFt' | 'midLegFt' | 'frontLegFt' | 'extraExpensesTotal' | 'extraExpensesJson'
> {}

class Quotation extends Model<QuotationAttributes, QuotationCreationAttributes> implements QuotationAttributes {
  public id!: string;
  public dealerId!: string;
  public customerId!: string;
  public systemType!: 'on-grid' | 'off-grid' | 'hybrid' | 'dcr' | 'non-dcr' | 'both' | 'customize';
  public status!: 'pending' | 'approved' | 'rejected' | 'completed';
  public discount!: number;
  public subtotal!: number;        // Set price (complete package price)
  public systemKw!: number | null;
  public sourceQuotationId!: string | null;
  public isCurrent!: boolean;
  public notes!: string | null;
  public totalAmount!: number;     // Amount after discount (Subtotal - Subsidy - Discount)
  public finalAmount!: number;     // Final amount (Subtotal - Subsidy, discount NOT applied)
  public centralSubsidy!: number;  // Central government subsidy
  public stateSubsidy!: number;    // State subsidy
  public totalSubsidy!: number;    // Total subsidy (central + state)
  public amountAfterSubsidy!: number; // Amount after subsidy
  public discountAmount!: number;  // Discount amount
  public paymentMode!: 'cash' | 'upi' | 'loan' | 'netbanking' | 'bank_transfer' | 'cheque' | 'card' | 'mix' | null;
  public paymentType!: 'loan' | 'cash' | 'mix' | null;
  public loanAmount!: number | null;
  public cashAmount!: number | null;
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
  public systemHistory!: Array<{
    products: Record<string, unknown>;
    pricing: Record<string, unknown>;
    label: string;
    savedAt: string;
    customPanels?: Array<Record<string, unknown>>;
  }> | null;
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
  public finalSettlementAmount!: number | null;
  public finalSettlementApplied!: boolean;
  public finalSettlementAt!: Date | null;
  public finalSettlementBy!: string | null;
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
  public installationStatus!: 'pending_installer' | 'installer_in_progress' | 'installer_partial_approved' | 'installer_approved' | 'installer_rejected' | 'pending_baldev' | 'baldev_approved' | 'baldev_rejected' | 'pending_metering' | 'metering_in_progress' | 'metering_approved' | 'meter_installation_pending' | 'mco' | 'completed';
  public installerId!: string | null;
  public installerActionAt!: Date | null;
  public installerInProgressAt!: Date | null;
  public installerApprovedAt!: Date | null;
  public installerRemarks!: string | null;
  public installationPartialApproved!: boolean;
  public installationPartialApprovedAt!: Date | null;
  public installationReadyForInstaller!: boolean;
  public installationReleasedAt!: Date | null;
  public installationScheduledAt!: string | null;
  public installationTeamId!: string | null;
  public baldevId!: string | null;
  public baldevActionAt!: Date | null;
  public baldevRemarks!: string | null;
  public meteringId!: string | null;
  public meteringActionAt!: Date | null;
  public meteringApprovedAt!: Date | null;
  public meteringRemarks!: string | null;
  public meteringAuthorizedRepresentative!: string | null;
  public discomName!: string | null;
  public discomLocation!: string | null;
  public meterType!: 'solar' | 'net' | 'both' | null;
  public meterNo!: string | null;
  public solarMeterNo!: string | null;
  public netMeterNo!: string | null;
  public meterDocumentImageUrl!: string | null;
  public meterInstallationPendingAt!: Date | null;
  public meteringWccAfterDiscom!: boolean;
  public meteringWccAfterDiscomAt!: Date | null;
  public bankProcessDone!: boolean;
  public bankProcessDoneAt!: Date | null;
  public meterInstallationPhotoUrl!: string | null;
  public meterInstallationPhotoName!: string | null;
  public plantLivePhotoUrl!: string | null;
  public plantLivePhotoName!: string | null;
  public mcoAt!: Date | null;
  public completionAt!: Date | null;
  public siteLengthCm!: number | null;
  public siteWidthCm!: number | null;
  public siteHeightCm!: number | null;
  public backLegFt!: number | null;
  public midLegFt!: number | null;
  public frontLegFt!: number | null;
  public extraExpensesTotal!: number | null;
  public extraExpensesJson!: Array<{ description: string; amount: number }> | null;
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
      type: DataTypes.DECIMAL(12, 2),
      defaultValue: 0
    },
    subtotal: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0
    },
    systemKw: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: 'system_kw'
    },
    sourceQuotationId: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    isCurrent: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
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
    loanAmount: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      field: 'loan_amount'
    },
    cashAmount: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      field: 'cash_amount'
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
    systemHistory: {
      type: DataTypes.JSONB,
      allowNull: false,
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
    finalSettlementAmount: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true
    },
    finalSettlementApplied: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    finalSettlementAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    finalSettlementBy: {
      type: DataTypes.STRING(50),
      allowNull: true
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
        'installer_partial_approved',
        'installer_approved',
        'installer_rejected',
        'pending_baldev',
        'baldev_approved',
        'baldev_rejected',
        'pending_metering',
        'metering_in_progress',
        'metering_approved',
        'meter_installation_pending',
        'mco',
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
    installationPartialApproved: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'installationPartialApproved'
    },
    installationPartialApprovedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'installationPartialApprovedAt'
    },
    installationReadyForInstaller: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    installationReleasedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    installationScheduledAt: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    installationTeamId: {
      type: DataTypes.STRING(50),
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
    meteringId: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    meteringActionAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    meteringApprovedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    meteringRemarks: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    meteringAuthorizedRepresentative: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'meteringAuthorizedRepresentative'
    },
    discomName: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    discomLocation: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    meterType: {
      type: DataTypes.ENUM('solar', 'net', 'both'),
      allowNull: true
    },
    meterNo: {
      type: DataTypes.STRING(120),
      allowNull: true
    },
    solarMeterNo: {
      type: DataTypes.STRING(120),
      allowNull: true
    },
    netMeterNo: {
      type: DataTypes.STRING(120),
      allowNull: true
    },
    meterDocumentImageUrl: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    meterInstallationPendingAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    meteringWccAfterDiscom: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    meteringWccAfterDiscomAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    bankProcessDone: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    bankProcessDoneAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    meterInstallationPhotoUrl: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    meterInstallationPhotoName: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    plantLivePhotoUrl: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    plantLivePhotoName: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    mcoAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    completionAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    siteLengthCm: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: true
    },
    siteWidthCm: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: true
    },
    siteHeightCm: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: true
    },
    backLegFt: {
      type: DataTypes.DECIMAL(12, 4),
      allowNull: true
    },
    midLegFt: {
      type: DataTypes.DECIMAL(12, 4),
      allowNull: true
    },
    frontLegFt: {
      type: DataTypes.DECIMAL(12, 4),
      allowNull: true
    },
    extraExpensesTotal: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true
    },
    extraExpensesJson: {
      type: DataTypes.JSONB,
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
      { fields: ['installationStatus', 'createdAt'] },
      { fields: ['installationReadyForInstaller'] },
      { fields: ['status', 'installationReadyForInstaller'] },
      { fields: ['installationTeamId'] }
    ]
  }
);

export default Quotation;


