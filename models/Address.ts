import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface AddressAttributes {
  id: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  created_at?: Date;
}

interface AddressCreationAttributes extends Optional<AddressAttributes, 'id' | 'line2' | 'created_at'> {}

class Address extends Model<AddressAttributes, AddressCreationAttributes> implements AddressAttributes {
  public id!: string;
  public line1!: string;
  public line2!: string | null;
  public city!: string;
  public state!: string;
  public postal_code!: string;
  public country!: string;
  public readonly created_at!: Date;
}

Address.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
    },
    line1: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    line2: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    city: {
      type: DataTypes.STRING(120),
      allowNull: false
    },
    state: {
      type: DataTypes.STRING(120),
      allowNull: false
    },
    postal_code: {
      type: DataTypes.STRING(30),
      allowNull: false
    },
    country: {
      type: DataTypes.STRING(120),
      allowNull: false
    }
  },
  {
    sequelize,
    tableName: 'addresses',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
  }
);

export default Address;