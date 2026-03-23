import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface CallingLeadAttributes {
  id: string;
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
  createdAt?: Date;
  updatedAt?: Date;
}

interface CallingLeadCreationAttributes extends Optional<CallingLeadAttributes, 'id' | 'altMobile' | 'kNumber' | 'address' | 'city' | 'state' | 'customerNote' | 'rawPayload' | 'createdAt' | 'updatedAt'> {}

class CallingLead extends Model<CallingLeadAttributes, CallingLeadCreationAttributes> implements CallingLeadAttributes {
  public id!: string;
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
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

CallingLead.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
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
    }
  },
  {
    sequelize,
    tableName: 'calling_leads',
    timestamps: true,
    freezeTableName: true,
    underscored: false,
    indexes: [
      { fields: ['mobile'], unique: true },
      { fields: ['mobileNormalized'], unique: true },
      { fields: ['createdAt'] }
    ]
  }
);

export default CallingLead;
