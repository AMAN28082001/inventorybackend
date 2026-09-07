import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface CallingLeadAttributes {
  id: string;
  batchId?: string | null;
  name: string;
  mobile: string;
  mobileNormalized: string;
  altMobile?: string | null;
  kNumber?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  customerNote?: string | null;
  rawPayload?: object | null;
  sheetSourceId?: string | null;
  externalId?: string | null;
  sheetRowIndex?: number | null;
  platform?: string | null;
  campaignName?: string | null;
  adName?: string | null;
  sheetLeadStatus?: string | null;
  remarks?: string | null;
  remarks2?: string | null;
  assignedPersonName?: string | null;
  firstCallResponse?: string | null;
  secondCallResponse?: string | null;
  loginFlag?: boolean | null;
  finalDecision?: string | null;
  finalDecisionReason?: string | null;
  sheetCreatedTime?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface CallingLeadCreationAttributes extends Optional<CallingLeadAttributes, 'id' | 'batchId' | 'altMobile' | 'kNumber' | 'address' | 'city' | 'state' | 'customerNote' | 'rawPayload' | 'sheetSourceId' | 'externalId' | 'sheetRowIndex' | 'platform' | 'campaignName' | 'adName' | 'sheetLeadStatus' | 'remarks' | 'remarks2' | 'assignedPersonName' | 'firstCallResponse' | 'secondCallResponse' | 'loginFlag' | 'finalDecision' | 'finalDecisionReason' | 'sheetCreatedTime' | 'createdAt' | 'updatedAt'> {}

class CallingLead extends Model<CallingLeadAttributes, CallingLeadCreationAttributes> implements CallingLeadAttributes {
  public id!: string;
  public batchId!: string | null;
  public name!: string;
  public mobile!: string;
  public mobileNormalized!: string;
  public altMobile!: string | null;
  public kNumber!: string | null;
  public address!: string | null;
  public city!: string | null;
  public state!: string | null;
  public customerNote!: string | null;
  public rawPayload!: object | null;
  public sheetSourceId!: string | null;
  public externalId!: string | null;
  public sheetRowIndex!: number | null;
  public platform!: string | null;
  public campaignName!: string | null;
  public adName!: string | null;
  public sheetLeadStatus!: string | null;
  public remarks!: string | null;
  public remarks2!: string | null;
  public assignedPersonName!: string | null;
  public firstCallResponse!: string | null;
  public secondCallResponse!: string | null;
  public loginFlag!: boolean | null;
  public finalDecision!: string | null;
  public finalDecisionReason!: string | null;
  public sheetCreatedTime!: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

CallingLead.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
    },
    batchId: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    name: {
      type: DataTypes.STRING(150),
      allowNull: false
    },
    mobile: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true
    },
    mobileNormalized: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true
    },
    altMobile: {
      type: DataTypes.STRING(20),
      allowNull: true
    },
    kNumber: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    city: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    state: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    customerNote: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    rawPayload: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    sheetSourceId: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    externalId: {
      type: DataTypes.STRING(128),
      allowNull: true
    },
    sheetRowIndex: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    platform: {
      type: DataTypes.STRING(64),
      allowNull: true
    },
    campaignName: {
      type: DataTypes.STRING(256),
      allowNull: true
    },
    adName: {
      type: DataTypes.STRING(256),
      allowNull: true
    },
    sheetLeadStatus: {
      type: DataTypes.STRING(64),
      allowNull: true
    },
    remarks: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    remarks2: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    assignedPersonName: {
      type: DataTypes.STRING(128),
      allowNull: true
    },
    firstCallResponse: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    secondCallResponse: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    loginFlag: {
      type: DataTypes.BOOLEAN,
      allowNull: true
    },
    finalDecision: {
      type: DataTypes.STRING(128),
      allowNull: true
    },
    finalDecisionReason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    sheetCreatedTime: {
      type: DataTypes.DATE,
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'calling_leads',
    timestamps: true,
    freezeTableName: true,
    underscored: false,
    indexes: [
      { fields: ['batchId'] },
      { fields: ['mobile'], unique: true },
      { fields: ['mobileNormalized'], unique: true },
      { fields: ['createdAt'] },
      { fields: ['sheetSourceId'] }
    ]
  }
);

export default CallingLead;
