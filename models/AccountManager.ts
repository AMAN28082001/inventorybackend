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
  isActive: boolean;
  emailVerified: boolean;
  loginCount: number;
  lastLogin?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string | null;
}

interface AccountManagerCreationAttributes extends Optional<AccountManagerAttributes, 'id' | 'role' | 'isActive' | 'emailVerified' | 'loginCount' | 'lastLogin' | 'createdAt' | 'updatedAt' | 'createdBy'> {}

class AccountManager extends Model<AccountManagerAttributes, AccountManagerCreationAttributes> implements AccountManagerAttributes {
  public id!: string;
  public username!: string;
  public password!: string;
  public firstName!: string;
  public lastName!: string;
  public email!: string;
  public mobile!: string;
  public role!: string;
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
