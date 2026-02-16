import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface ProductSerialNumberAttributes {
  id: string;
  product_id: string;
  serial_number: string;
  price?: number | null;
  cost_price?: number | null;
  product_name: string;
  category: string;
  stock_addition_id?: string | null;
  owner_id?: string | null;
  owner_type?: 'super-admin' | 'admin' | 'agent' | null;
  status?: 'available' | 'sold' | 'returned' | 'damaged';
  created_at?: Date;
  updated_at?: Date;
}

interface ProductSerialNumberCreationAttributes extends Optional<ProductSerialNumberAttributes, 'id' | 'price' | 'cost_price' | 'stock_addition_id' | 'owner_id' | 'owner_type' | 'status' | 'created_at' | 'updated_at'> {}

class ProductSerialNumber extends Model<ProductSerialNumberAttributes, ProductSerialNumberCreationAttributes> implements ProductSerialNumberAttributes {
  public id!: string;
  public product_id!: string;
  public serial_number!: string;
  public price!: number | null;
  public cost_price!: number | null;
  public product_name!: string;
  public category!: string;
  public stock_addition_id!: string | null;
  public owner_id!: string | null;
  public owner_type!: 'super-admin' | 'admin' | 'agent' | null;
  public status!: 'available' | 'sold' | 'returned' | 'damaged';
  public readonly created_at!: Date;
  public readonly updated_at!: Date;
}

ProductSerialNumber.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
    },
    product_id: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    serial_number: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    },
    cost_price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    },
    product_name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    category: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    stock_addition_id: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    owner_id: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    owner_type: {
      type: DataTypes.ENUM('super-admin', 'admin', 'agent'),
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('available', 'sold', 'returned', 'damaged'),
      allowNull: false,
      defaultValue: 'available'
    }
  },
  {
    sequelize,
    tableName: 'product_serial_numbers',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['product_id'], name: 'idx_product_serial_numbers_product' },
      { fields: ['serial_number'], name: 'idx_product_serial_numbers_serial' }
    ]
  }
);

export default ProductSerialNumber;
