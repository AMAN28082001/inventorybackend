import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface SaleItemAttributes {
  id: string;
  sale_id: string;
  product_id?: string | null;
  product_name: string;
  model: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  gst_rate: number;
  serial_numbers?: string[] | null;
}

interface SaleItemCreationAttributes extends Optional<SaleItemAttributes, 'id' | 'product_id' | 'gst_rate' | 'serial_numbers'> {}

class SaleItem extends Model<SaleItemAttributes, SaleItemCreationAttributes> implements SaleItemAttributes {
  public id!: string;
  public sale_id!: string;
  public product_id!: string | null;
  public product_name!: string;
  public model!: string;
  public quantity!: number;
  public unit_price!: number;
  public line_total!: number;
  public gst_rate!: number;
  public serial_numbers!: string[] | null;
}

SaleItem.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
    },
    sale_id: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    product_id: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    product_name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    model: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1
      }
    },
    unit_price: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      validate: {
        min: 0
      }
    },
    line_total: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      validate: {
        min: 0
      }
    },
    gst_rate: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 0,
      validate: {
        min: 0
      }
    },
    serial_numbers: {
      type: DataTypes.JSONB,
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'sale_items',
    timestamps: false,
    indexes: [
      { fields: ['sale_id'], name: 'idx_sale_items_sale' },
      { fields: ['product_id'], name: 'idx_sale_items_product' }
    ]
  }
);

export default SaleItem;



