import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface QuotationPaymentPhaseAttributes {
  id: string;
  quotationId: string;
  phaseNumber: number;
  phaseName: string;
  amount: number;
  paidAmount: number;
  status: 'pending' | 'partial' | 'completed';
  dueDate?: Date | null;
  paymentDate?: Date | null;
  paymentMode?: 'cash' | 'upi' | 'loan' | 'netbanking' | 'bank_transfer' | 'cheque' | 'card' | 'mix' | null;
  transactionId?: string | null;
  note?: string | null;
  updatedBy?: string | null;
  updatedAtPhase?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface QuotationPaymentPhaseCreationAttributes extends Optional<
  QuotationPaymentPhaseAttributes,
  | 'id'
  | 'dueDate'
  | 'paymentDate'
  | 'paymentMode'
  | 'transactionId'
  | 'note'
  | 'updatedBy'
  | 'updatedAtPhase'
  | 'createdAt'
  | 'updatedAt'
> {}

class QuotationPaymentPhase
  extends Model<QuotationPaymentPhaseAttributes, QuotationPaymentPhaseCreationAttributes>
  implements QuotationPaymentPhaseAttributes {
  public id!: string;
  public quotationId!: string;
  public phaseNumber!: number;
  public phaseName!: string;
  public amount!: number;
  public paidAmount!: number;
  public status!: 'pending' | 'partial' | 'completed';
  public dueDate!: Date | null;
  public paymentDate!: Date | null;
  public paymentMode!: 'cash' | 'upi' | 'loan' | 'netbanking' | 'bank_transfer' | 'cheque' | 'card' | 'mix' | null;
  public transactionId!: string | null;
  public note!: string | null;
  public updatedBy!: string | null;
  public updatedAtPhase!: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

QuotationPaymentPhase.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
    },
    quotationId: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    phaseNumber: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    phaseName: {
      type: DataTypes.STRING(120),
      allowNull: false
    },
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0
    },
    paidAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0
    },
    status: {
      type: DataTypes.ENUM('pending', 'partial', 'completed'),
      allowNull: false,
      defaultValue: 'pending'
    },
    dueDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    paymentDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    paymentMode: {
      type: DataTypes.STRING(30),
      allowNull: true
    },
    transactionId: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    updatedBy: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    updatedAtPhase: {
      type: DataTypes.DATE,
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'quotation_payment_phases',
    timestamps: true,
    freezeTableName: true,
    underscored: false,
    indexes: [
      { fields: ['quotationId'] },
      { fields: ['quotationId', 'phaseNumber'], unique: true },
      { fields: ['status'] },
      { fields: ['paymentDate'] }
    ]
  }
);

export default QuotationPaymentPhase;
