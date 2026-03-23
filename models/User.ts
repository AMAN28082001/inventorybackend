import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

// Model.init() accesses sequelize.options.define synchronously, so it MUST exist
// The database config should have set this, but we ensure it exists here as a safeguard
const sequelizeAny = sequelize as any;

// CRITICAL: Set options.define if it doesn't exist
// We do this directly without replacing the options object
if (!sequelizeAny.options) {
  // Last resort - create minimal options object
  sequelizeAny.options = { define: {} };
}
if (!sequelizeAny.options.define) {
  sequelizeAny.options.define = {
    timestamps: true,
    underscored: false,
    freezeTableName: true
  };
}

// CRITICAL FIX: Ensure runHooks and isDefined methods exist before Model.init() is called
// This is a safeguard in case the database.ts fix hasn't run yet
if (!sequelizeAny.runHooks || typeof sequelizeAny.runHooks !== 'function') {
  // Ensure hooks object exists
  if (!sequelizeAny.hooks) {
    sequelizeAny.hooks = {
      _hooks: {},
      run: async function(name: string, ...args: any[]) {
        if (!this._hooks[name]) return;
        for (const hook of this._hooks[name]) {
          await hook(...args);
        }
      }
    };
  }
  // Define runHooks method
  Object.defineProperty(sequelizeAny, 'runHooks', {
    value: function(name: string, ...args: any[]) {
      const hooks = this.hooks || sequelizeAny.hooks;
      if (hooks && typeof hooks.run === 'function') {
        return hooks.run(name, ...args);
      }
      return Promise.resolve();
    },
    writable: true,
    enumerable: true,
    configurable: true
  });
}

// CRITICAL FIX: Ensure isDefined and normalizeAttribute methods exist
if (!sequelizeAny.isDefined || typeof sequelizeAny.isDefined !== 'function') {
  Object.defineProperty(sequelizeAny, 'isDefined', {
    value: function(modelName: string): boolean {
      // Check if model exists in the models registry
      if (this.models && this.models[modelName]) {
        return true;
      }
      if (this.modelManager && this.modelManager.models && this.modelManager.models[modelName]) {
        return true;
      }
      // Check if model exists in the internal _models registry
      if (this._models && this._models[modelName]) {
        return true;
      }
      return false;
    },
    writable: true,
    enumerable: true,
    configurable: true
  });
}

if (!sequelizeAny.normalizeAttribute || typeof sequelizeAny.normalizeAttribute !== 'function') {
  Object.defineProperty(sequelizeAny, 'normalizeAttribute', {
    value: function(attribute: any): any {
      // If attribute is already an object with type, return as is
      if (attribute && typeof attribute === 'object' && attribute.type) {
        return attribute;
      }
      // If attribute is a DataType, wrap it in an object
      if (attribute && typeof attribute === 'object' && attribute.key) {
        return { type: attribute };
      }
      // Return attribute as is (fallback)
      return attribute;
    },
    writable: true,
    enumerable: true,
    configurable: true
  });
}

// CRITICAL FIX: Ensure getQueryInterface method exists
if (!sequelizeAny.getQueryInterface || typeof sequelizeAny.getQueryInterface !== 'function') {
  Object.defineProperty(sequelizeAny, 'getQueryInterface', {
    value: function() {
      let qi: any = null;
      
      // Return existing queryInterface if it exists
      if (this.queryInterface) {
        qi = this.queryInterface;
      }
      // Try to get it from dialect
      else if (this.dialect && this.dialect.queryInterface) {
        qi = this.dialect.queryInterface;
      }
      // Try common dialect property names without calling getDialect
      else {
        const dialectKeys = ['dialect-postgres', 'dialect-postgresql', 'dialect'];
        for (const key of dialectKeys) {
          if (this[key] && this[key].queryInterface) {
            qi = this[key].queryInterface;
            break;
          }
        }
      }
      
      // If we found a queryInterface, ensure it has queryGenerator
      if (qi) {
        if (!qi.queryGenerator) {
          qi.queryGenerator = {
            addSchema: function(model: any) {
              const tableName = model.tableName || model.name || 'unknown';
              return tableName;
            },
            quoteIdentifier: (identifier: string) => `"${identifier}"`,
            quoteTable: (table: string) => `"${table}"`
          };
        }
        return qi;
      }
      
      // Fallback: create a minimal queryInterface-like object with queryGenerator
      if (!this._fallbackQueryInterface) {
        this._fallbackQueryInterface = {
          quoteIdentifier: (identifier: string) => `"${identifier}"`,
          quoteTable: (table: string) => `"${table}"`,
          escape: (value: any) => {
            if (typeof value === 'string') {
              return `'${value.replace(/'/g, "''")}'`;
            }
            return value;
          },
          queryGenerator: {
            addSchema: function(model: any) {
              // Return table name with schema prefix if needed
              const tableName = model.tableName || model.name || 'unknown';
              return tableName;
            },
            quoteIdentifier: (identifier: string) => `"${identifier}"`,
            quoteTable: (table: string) => `"${table}"`
          }
        };
      }
      return this._fallbackQueryInterface;
    },
    writable: true,
    enumerable: true,
    configurable: true
  });
}

interface UserAttributes {
  id: string;
  username: string;
  password: string;
  name: string;
  role: 'super-admin' | 'super-admin-manager' | 'admin' | 'agent' | 'account' | 'installer' | 'baldev' | 'confirmation' | 'hr';
  is_active: boolean;
  created_by_id?: string | null;
  created_by_name?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

interface UserCreationAttributes extends Optional<UserAttributes, 'id' | 'is_active' | 'created_by_id' | 'created_by_name' | 'created_at' | 'updated_at'> {}

class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
  public id!: string;
  public username!: string;
  public password!: string;
  public name!: string;
  public role!: 'super-admin' | 'super-admin-manager' | 'admin' | 'agent' | 'account' | 'installer' | 'baldev' | 'confirmation' | 'hr';
  public is_active!: boolean;
  public created_by_id!: string | null;
  public created_by_name!: string | null;
  public readonly created_at!: Date;
  public readonly updated_at!: Date;
}

User.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
    },
    username: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    role: {
      type: DataTypes.ENUM('super-admin', 'super-admin-manager', 'admin', 'agent', 'account', 'installer', 'baldev', 'confirmation', 'hr'),
      allowNull: false
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    created_by_id: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    created_by_name: {
      type: DataTypes.STRING(255),
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'users',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    freezeTableName: true,
    underscored: false,
    indexes: [
      { fields: ['username'] },
      { fields: ['role'] },
      { fields: ['is_active'] },
      { fields: ['created_by_id'] }
    ]
  }
);

export default User;

