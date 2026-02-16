import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface ProductAttributes {
  id: string;
  name: string;
  model: string;
  category: string;
  wattage?: string | null;
  quantity: number;
  unit_price?: number | null;
  selling_price?: number | null;
  image?: string | null;
  created_by?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

interface ProductCreationAttributes extends Optional<ProductAttributes, 'id' | 'quantity' | 'wattage' | 'unit_price' | 'selling_price' | 'image' | 'created_by' | 'created_at' | 'updated_at'> {}

class Product extends Model<ProductAttributes, ProductCreationAttributes> implements ProductAttributes {
  public id!: string;
  public name!: string;
  public model!: string;
  public category!: string;
  public wattage!: string | null;
  public quantity!: number;
  public unit_price!: number | null;
  public selling_price!: number | null;
  public image!: string | null;
  public created_by!: string | null;
  public readonly created_at!: Date;
  public readonly updated_at!: Date;
}

Product.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    model: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    category: {
      type: DataTypes.STRING(120),
      allowNull: false
    },
    wattage: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: {
        min: 0
      }
    },
    unit_price: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      validate: {
        min: 0
      }
    },
    selling_price: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      validate: {
        min: 0
      }
    },
    image: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    created_by: {
      type: DataTypes.STRING(50),
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'products',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['name'] },
      { fields: ['model'] },
      { fields: ['category'] },
      {
        unique: true,
        fields: ['name', 'model'],
        name: 'uq_product_name_model'
      }
    ]
  }
);

export default Product;



