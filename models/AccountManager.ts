import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface AccountManagerAttributes {
  id: string;
  username: string;
  password: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  role: string;
  /** Dashboard section keys (BACKEND_USER_ACCESS.md) */
  access?: string[] | null;
  gender?: string | null;
  dateOfBirth?: Date | string | null;
  fatherName?: string | null;
  fatherContact?: string | null;
  governmentIdType?: string | null;
  governmentIdNumber?: string | null;
  employeeId?: string | null;
  addressStreet?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressPincode?: string | null;
  isActive: boolean;
  emailVerified: boolean;
  loginCount: number;
  lastLogin?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string | null;
}

interface AccountManagerCreationAttributes extends Optional<
  AccountManagerAttributes,
  'id' | 'role' | 'access' | 'gender' | 'dateOfBirth' | 'fatherName' | 'fatherContact' | 'governmentIdType' | 'governmentIdNumber' | 'employeeId' | 'addressStreet' | 'addressCity' | 'addressState' | 'addressPincode' | 'isActive' | 'emailVerified' | 'loginCount' | 'lastLogin' | 'createdAt' | 'updatedAt' | 'createdBy'
> {}

class AccountManager extends Model<AccountManagerAttributes, AccountManagerCreationAttributes> implements AccountManagerAttributes {
  public id!: string;
  public username!: string;
  public password!: string;
  public firstName!: string;
  public lastName!: string;
  public email!: string;
  public mobile!: string;
  public role!: string;
  public access!: string[] | null;
  public gender!: string | null;
  public dateOfBirth!: Date | string | null;
  public fatherName!: string | null;
  public fatherContact!: string | null;
  public governmentIdType!: string | null;
  public governmentIdNumber!: string | null;
  public employeeId!: string | null;
  public addressStreet!: string | null;
  public addressCity!: string | null;
  public addressState!: string | null;
  public addressPincode!: string | null;
  public isActive!: boolean;
  public emailVerified!: boolean;
  public loginCount!: number;
  public lastLogin!: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
  public createdBy!: string | null;
}

AccountManager.init(
  {
    id: {
      type: DataTypes.STRING(255),
      primaryKey: true
    },
    username: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    firstName: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    lastName: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true
    },
    mobile: {
      type: DataTypes.STRING(20),
      allowNull: false
    },
    role: {
      type: DataTypes.STRING(50),
      defaultValue: 'account-management',
      allowNull: false
    },
    access: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    },
    gender: {
      type: DataTypes.STRING(20),
      allowNull: true
    },
    dateOfBirth: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    fatherName: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    fatherContact: {
      type: DataTypes.STRING(15),
      allowNull: true
    },
    governmentIdType: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    governmentIdNumber: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    employeeId: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    addressStreet: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    addressCity: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    addressState: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    addressPincode: {
      type: DataTypes.STRING(6),
      allowNull: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false
    },
    emailVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false
    },
    loginCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false
    },
    lastLogin: {
      type: DataTypes.DATE,
      allowNull: true
    },
    createdBy: {
      type: DataTypes.STRING(255),
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'account_managers',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    freezeTableName: true,
    underscored: false,
    indexes: [
      { fields: ['username'] },
      { fields: ['email'] },
      { fields: ['isActive'] },
      { fields: ['createdAt'] }
    ]
  }
);

export default AccountManager;
