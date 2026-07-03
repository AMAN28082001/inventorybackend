import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface AdminInventoryAttributes {
  id: string;
  admin_id: string;
  product_id: string;
  quantity: number;
  created_at?: Date;
  updated_at?: Date;
}

interface AdminInventoryCreationAttributes extends Optional<AdminInventoryAttributes, 'id' | 'created_at' | 'updated_at'> {}

class AdminInventory extends Model<AdminInventoryAttributes, AdminInventoryCreationAttributes> implements AdminInventoryAttributes {
  public id!: string;
  public admin_id!: string;
  public product_id!: string;
  public quantity!: number;
  public readonly created_at!: Date;
  public readonly updated_at!: Date;
}

AdminInventory.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
    },
    admin_id: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    product_id: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    quantity: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false,
      defaultValue: 0
    }
  },
  {
    sequelize,
    tableName: 'admin_inventory',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['admin_id'] },
      { fields: ['product_id'] },
      {
        unique: true,
        fields: ['admin_id', 'product_id'],
        name: 'unique_admin_product'
      }
    ]
  }
);

export default AdminInventory;



