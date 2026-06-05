import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface VisitAttributes {
  id: string;
  quotationId: string;
  dealerId: string;
  visitDate: Date;
  visitTime: string;
  location: string;
  locationLink?: string | null;
  notes?: string | null;
  status: 'pending' | 'approved' | 'completed' | 'incomplete' | 'rejected' | 'rescheduled';
  feedback?: string | null;
  rejectionReason?: string | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  images?: any | null; // JSONB field
  rowDiagramImage?: string | null;
  unit?: 'feet' | 'cm' | null;
  backLegFeet?: number | null;
  midLegFeet?: number | null;
  frontLegFeet?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface VisitCreationAttributes extends Optional<VisitAttributes, 'id' | 'locationLink' | 'notes' | 'status' | 'feedback' | 'rejectionReason' | 'length' | 'width' | 'height' | 'images' | 'rowDiagramImage' | 'unit' | 'backLegFeet' | 'midLegFeet' | 'frontLegFeet' | 'createdAt' | 'updatedAt'> {}

class Visit extends Model<VisitAttributes, VisitCreationAttributes> implements VisitAttributes {
  public id!: string;
  public quotationId!: string;
  public dealerId!: string;
  public visitDate!: Date;
  public visitTime!: string;
  public location!: string;
  public locationLink!: string | null;
  public notes!: string | null;
  public status!: 'pending' | 'approved' | 'completed' | 'incomplete' | 'rejected' | 'rescheduled';
  public feedback!: string | null;
  public rejectionReason!: string | null;
  public length!: number | null;
  public width!: number | null;
  public height!: number | null;
  public images!: any | null;
  public rowDiagramImage!: string | null;
  public unit!: 'feet' | 'cm' | null;
  public backLegFeet!: number | null;
  public midLegFeet!: number | null;
  public frontLegFeet!: number | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Visit.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
    },
    quotationId: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    dealerId: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    visitDate: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    visitTime: {
      type: DataTypes.STRING(32),
      allowNull: false
    },
    location: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    locationLink: {
      type: DataTypes.STRING(500),
      allowNull: true,
      defaultValue: null
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('pending', 'approved', 'completed', 'incomplete', 'rejected', 'rescheduled'),
      defaultValue: 'pending'
    },
    feedback: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    rejectionReason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    length: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    },
    width: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    },
    height: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    },
    images: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    rowDiagramImage: {
      type: DataTypes.STRING(1000),
      allowNull: true
    },
    unit: {
      type: DataTypes.ENUM('feet', 'cm'),
      allowNull: true
    },
    backLegFeet: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    },
    midLegFeet: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    },
    frontLegFeet: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'visits',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    freezeTableName: true,
    underscored: false,
    indexes: [
      { fields: ['quotationId'] },
      { fields: ['dealerId'] },
      { fields: ['visitDate', 'visitTime'] },
      { fields: ['status'] },
      { fields: ['dealerId', 'visitDate', 'status'] }
    ]
  }
);

export default Visit;


