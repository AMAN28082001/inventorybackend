import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface VisitorAttributes {
  id: string;
  username: string;
  password: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  employeeId?: string | null;
  /** Dashboard section keys */
  access?: string[] | null;
  gender?: string | null;
  dateOfBirth?: Date | string | null;
  fatherName?: string | null;
  fatherContact?: string | null;
  governmentIdType?: string | null;
  governmentIdNumber?: string | null;
  addressStreet?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressPincode?: string | null;
  emailVerified?: boolean;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface VisitorCreationAttributes extends Optional<VisitorAttributes, 'id' | 'employeeId' | 'access' | 'gender' | 'dateOfBirth' | 'fatherName' | 'fatherContact' | 'governmentIdType' | 'governmentIdNumber' | 'addressStreet' | 'addressCity' | 'addressState' | 'addressPincode' | 'emailVerified' | 'isActive' | 'createdAt' | 'updatedAt'> {}

class Visitor extends Model<VisitorAttributes, VisitorCreationAttributes> implements VisitorAttributes {
  public id!: string;
  public username!: string;
  public password!: string;
  public firstName!: string;
  public lastName!: string;
  public email!: string;
  public mobile!: string;
  public employeeId!: string | null;
  public access!: string[] | null;
  public gender!: string | null;
  public dateOfBirth!: Date | string | null;
  public fatherName!: string | null;
  public fatherContact!: string | null;
  public governmentIdType!: string | null;
  public governmentIdNumber!: string | null;
  public addressStreet!: string | null;
  public addressCity!: string | null;
  public addressState!: string | null;
  public addressPincode!: string | null;
  public emailVerified!: boolean;
  public isActive!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Visitor.init(
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
      allowNull: false
    },
    employeeId: {
      type: DataTypes.STRING(50),
      allowNull: true,
      unique: true
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
    emailVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  },
  {
    sequelize,
    tableName: 'visitors',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    freezeTableName: true,
    underscored: false,
    indexes: [
      { fields: ['username'] },
      { fields: ['email'] },
      { fields: ['isActive'] }
    ]
  }
);

export default Visitor;

