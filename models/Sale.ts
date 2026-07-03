import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface SaleAttributes {
  id: string;
  type: 'B2B' | 'B2C';
  customer_name: string;
  product_summary: string;
  total_quantity: number;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  payment_status: 'pending' | 'completed';
  approval_status?: 'pending' | 'approved';
  sale_date?: Date;
  image?: string | null;
  created_by?: string | null;
  company_name?: string | null;
  gst_number?: string | null;
  contact_person?: string | null;
  billing_address_id?: string | null;
  delivery_address_id?: string | null;
  delivery_matches_billing?: boolean | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  delivery_instructions?: string | null;
  bill_image?: string | null;
  bill_confirmed_date?: Date | null;
  bill_confirmed_by_id?: string | null;
  bill_confirmed_by_name?: string | null;
  notes?: string | null;
}

interface SaleCreationAttributes extends Optional<SaleAttributes, 'id' | 'payment_status' | 'approval_status' | 'sale_date' | 'tax_amount' | 'discount_amount' | 'image' | 'created_by' | 'company_name' | 'gst_number' | 'contact_person' | 'billing_address_id' | 'delivery_address_id' | 'delivery_matches_billing' | 'customer_email' | 'customer_phone' | 'delivery_instructions' | 'bill_image' | 'bill_confirmed_date' | 'bill_confirmed_by_id' | 'bill_confirmed_by_name' | 'notes'> {}

class Sale extends Model<SaleAttributes, SaleCreationAttributes> implements SaleAttributes {
  public id!: string;
  public type!: 'B2B' | 'B2C';
  public customer_name!: string;
  public product_summary!: string;
  public total_quantity!: number;
  public subtotal!: number;
  public tax_amount!: number;
  public discount_amount!: number;
  public total_amount!: number;
  public payment_status!: 'pending' | 'completed';
  public approval_status!: 'pending' | 'approved';
  public sale_date!: Date;
  public image!: string | null;
  public created_by!: string | null;
  public company_name!: string | null;
  public gst_number!: string | null;
  public contact_person!: string | null;
  public billing_address_id!: string | null;
  public delivery_address_id!: string | null;
  public delivery_matches_billing!: boolean | null;
  public customer_email!: string | null;
  public customer_phone!: string | null;
  public delivery_instructions!: string | null;
  public bill_image!: string | null;
  public bill_confirmed_date!: Date | null;
  public bill_confirmed_by_id!: string | null;
  public bill_confirmed_by_name!: string | null;
  public notes!: string | null;
}

Sale.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
    },
    type: {
      type: DataTypes.ENUM('B2B', 'B2C'),
      allowNull: false
    },
    customer_name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    product_summary: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    total_quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1
      }
    },
    subtotal: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      validate: {
        min: 0
      }
    },
    tax_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0,
      validate: {
        min: 0
      }
    },
    discount_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0,
      validate: {
        min: 0
      }
    },
    total_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      validate: {
        min: 0
      }
    },
    payment_status: {
      type: DataTypes.ENUM('pending', 'completed'),
      defaultValue: 'pending'
    },
    approval_status: {
      type: DataTypes.ENUM('pending', 'approved'),
      defaultValue: 'pending'
    },
    sale_date: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    image: {
      type: DataTypes.STRING(2048),
      allowNull: true
    },
    created_by: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    company_name: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    gst_number: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    contact_person: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    billing_address_id: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    delivery_address_id: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    delivery_matches_billing: {
      type: DataTypes.BOOLEAN,
      allowNull: true
    },
    customer_email: {
      type: DataTypes.STRING(255),
      allowNull: true,
      validate: {
        isEmail: {
          msg: 'customer_email must be a valid email'
        }
      }
    },
    customer_phone: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    delivery_instructions: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    bill_image: {
      type: DataTypes.STRING(2048),
      allowNull: true
    },
    bill_confirmed_date: {
      type: DataTypes.DATE,
      allowNull: true
    },
    bill_confirmed_by_id: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    bill_confirmed_by_name: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'sales',
    timestamps: false,
    indexes: [
      { fields: ['type'], name: 'idx_sales_type' },
      { fields: ['payment_status'], name: 'idx_sales_payment_status' },
      { fields: ['sale_date'], name: 'idx_sales_sale_date' },
      { fields: ['customer_name'], name: 'idx_sales_customer_name' },
      { fields: ['bill_confirmed_date'], name: 'idx_sales_bill_confirmed_date' }
    ]
  }
);

export default Sale;



