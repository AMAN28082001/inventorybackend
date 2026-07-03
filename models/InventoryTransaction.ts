import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface InventoryTransactionAttributes {
  id: string;
  product_id: string;
  transaction_type: 'purchase' | 'sale' | 'return' | 'adjustment' | 'transfer';
  quantity: number;
  reference?: string | null;
  related_stock_request_id?: string | null;
  related_sale_id?: string | null;
  notes?: string | null;
  created_by?: string | null;
  timestamp?: Date;
}

interface InventoryTransactionCreationAttributes extends Optional<InventoryTransactionAttributes, 'id' | 'reference' | 'related_stock_request_id' | 'related_sale_id' | 'notes' | 'created_by' | 'timestamp'> {}

class InventoryTransaction extends Model<InventoryTransactionAttributes, InventoryTransactionCreationAttributes> implements InventoryTransactionAttributes {
  public id!: string;
  public product_id!: string;
  public transaction_type!: 'purchase' | 'sale' | 'return' | 'adjustment' | 'transfer';
  public quantity!: number;
  public reference!: string | null;
  public related_stock_request_id!: string | null;
  public related_sale_id!: string | null;
  public notes!: string | null;
  public created_by!: string | null;
  public timestamp!: Date;
}

InventoryTransaction.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
    },
    product_id: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    transaction_type: {
      type: DataTypes.ENUM('purchase', 'sale', 'return', 'adjustment', 'transfer'),
      allowNull: false
    },
    quantity: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false
    },
    reference: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    related_stock_request_id: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    related_sale_id: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    created_by: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    timestamp: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  },
  {
    sequelize,
    tableName: 'inventory_transactions',
    timestamps: false,
    indexes: [
      { fields: ['product_id'] },
      { fields: ['transaction_type'] },
      { fields: ['timestamp'] },
      { fields: ['reference'] }
    ]
  }
);

export default InventoryTransaction;



