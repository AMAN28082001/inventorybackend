import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

type DealerRequestStatus = 'new' | 'in_progress' | 'completed' | 'rejected';

interface DealerRequestAttributes {
  id: string;
  customerName: string;
  phoneNumber: string;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  message?: string | null;
  source?: string | null;
  status: DealerRequestStatus;
  assignedDealerId?: string | null;
  assignedByAdminId?: string | null;
  actionRemark?: string | null;
  requestPayload?: object | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface DealerRequestCreationAttributes extends Optional<
  DealerRequestAttributes,
  | 'id'
  | 'email'
  | 'city'
  | 'state'
  | 'address'
  | 'message'
  | 'source'
  | 'status'
  | 'assignedDealerId'
  | 'assignedByAdminId'
  | 'actionRemark'
  | 'requestPayload'
  | 'createdAt'
  | 'updatedAt'
> {}

class DealerRequest
  extends Model<DealerRequestAttributes, DealerRequestCreationAttributes>
  implements DealerRequestAttributes
{
  public id!: string;
  public customerName!: string;
  public phoneNumber!: string;
  public email!: string | null;
  public city!: string | null;
  public state!: string | null;
  public address!: string | null;
  public message!: string | null;
  public source!: string | null;
  public status!: DealerRequestStatus;
  public assignedDealerId!: string | null;
  public assignedByAdminId!: string | null;
  public actionRemark!: string | null;
  public requestPayload!: object | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

DealerRequest.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
    },
    customerName: {
      type: DataTypes.STRING(150),
      allowNull: false
    },
    phoneNumber: {
      type: DataTypes.STRING(20),
      allowNull: false
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    city: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    state: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    source: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('new', 'in_progress', 'completed', 'rejected'),
      allowNull: false,
      defaultValue: 'new'
    },
    assignedDealerId: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    assignedByAdminId: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    actionRemark: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    requestPayload: {
      type: DataTypes.JSONB,
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'dealer_requests',
    timestamps: true,
    freezeTableName: true,
    underscored: false,
    indexes: [
      { fields: ['createdAt'] },
      { fields: ['status'] },
      { fields: ['assignedDealerId'] },
      { fields: ['phoneNumber'] }
    ]
  }
);

export default DealerRequest;
