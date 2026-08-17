import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface DealerAttributes {
  id: string;
  username: string;
  password: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  company?: string | null;
  gender: 'Male' | 'Female' | 'Other';
  dateOfBirth: Date;
  fatherName: string;
  fatherContact: string;
  governmentIdType: 'Aadhaar Card' | 'PAN Card' | 'Voter ID' | 'Driving License' | 'Passport';
  governmentIdNumber: string;
  governmentIdImage?: string | null;
  addressStreet: string;
  addressCity: string;
  addressState: string;
  addressPincode: string;
  role: 'dealer' | 'admin';
  /** Dashboard section keys (BACKEND_USER_ACCESS.md) */
  access?: string[] | null;
  isActive: boolean;
  emailVerified: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface DealerCreationAttributes extends Optional<
  DealerAttributes,
  'id' | 'company' | 'governmentIdImage' | 'access' | 'isActive' | 'emailVerified' | 'createdAt' | 'updatedAt'
> {}

class Dealer extends Model<DealerAttributes, DealerCreationAttributes> implements DealerAttributes {
  public id!: string;
  public username!: string;
  public password!: string;
  public firstName!: string;
  public lastName!: string;
  public email!: string;
  public mobile!: string;
  public company!: string | null;
  public gender!: 'Male' | 'Female' | 'Other';
  public dateOfBirth!: Date;
  public fatherName!: string;
  public fatherContact!: string;
  public governmentIdType!: 'Aadhaar Card' | 'PAN Card' | 'Voter ID' | 'Driving License' | 'Passport';
  public governmentIdNumber!: string;
  public governmentIdImage!: string | null;
  public addressStreet!: string;
  public addressCity!: string;
  public addressState!: string;
  public addressPincode!: string;
  public role!: 'dealer' | 'admin';
  public access!: string[] | null;
  public isActive!: boolean;
  public emailVerified!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Dealer.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
    },
    username: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    firstName: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    lastName: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true
    },
    mobile: {
      type: DataTypes.STRING(15),
      allowNull: false,
      unique: true
    },
    company: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    gender: {
      type: DataTypes.ENUM('Male', 'Female', 'Other'),
      allowNull: false
    },
    dateOfBirth: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    fatherName: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    fatherContact: {
      type: DataTypes.STRING(15),
      allowNull: false
    },
    governmentIdType: {
      type: DataTypes.ENUM('Aadhaar Card', 'PAN Card', 'Voter ID', 'Driving License', 'Passport'),
      allowNull: false
    },
    governmentIdNumber: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    governmentIdImage: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    addressStreet: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    addressCity: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    addressState: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    addressPincode: {
      type: DataTypes.STRING(10),
      allowNull: false
    },
    role: {
      type: DataTypes.ENUM('dealer', 'admin'),
      allowNull: false
    },
    access: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    emailVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    }
  },
  {
    sequelize,
    tableName: 'dealers',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    freezeTableName: true,
    underscored: false,
    indexes: [
      { fields: ['username'] },
      { fields: ['email'] },
      { fields: ['mobile'] },
      { fields: ['role'] },
      { fields: ['isActive'] }
    ]
  }
);

export default Dealer;


