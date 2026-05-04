import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface InstallationTeamAttributes {
  id: string;
  name: string;
  username: string;
  password: string;
  isActive: boolean;
  createdBy?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface InstallationTeamCreationAttributes
  extends Optional<InstallationTeamAttributes, 'id' | 'isActive' | 'createdBy' | 'createdAt' | 'updatedAt'> {}

class InstallationTeam
  extends Model<InstallationTeamAttributes, InstallationTeamCreationAttributes>
  implements InstallationTeamAttributes
{
  public id!: string;
  public name!: string;
  public username!: string;
  public password!: string;
  public isActive!: boolean;
  public createdBy!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

InstallationTeam.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false
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
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    createdBy: {
      type: DataTypes.STRING(50),
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'installation_teams',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    freezeTableName: true,
    underscored: false
  }
);

export default InstallationTeam;
