import sequelize from '../config/database';

// Import all models
import User from './User';
import Product from './Product';
import AdminInventory from './AdminInventory';
import StockRequest from './StockRequest';
import StockRequestItem from './StockRequestItem';
import Address from './Address';
import Sale from './Sale';
import SaleItem from './SaleItem';
import InventoryTransaction from './InventoryTransaction';
import StockReturn from './StockReturn';
import AccountManager from './AccountManager';
import AccountManagerHistory from './AccountManagerHistory';
import ProductSerialNumber from './ProductSerialNumber';
import CallingLead from './CallingLead';
import DealerLeadAssignment from './DealerLeadAssignment';
import CallingActionHistory from './CallingActionHistory';
import CallingLeadUploadBatch from './CallingLeadUploadBatch';
import CallingLeadUploadRow from './CallingLeadUploadRow';
import QuotationPaymentPhase from './QuotationPaymentPhase';
import Review from './Review';

// Define all associations

// User associations
User.hasMany(Product, { foreignKey: 'created_by', as: 'createdProducts' });
User.hasMany(AdminInventory, { foreignKey: 'admin_id', as: 'inventory' });
User.hasMany(StockRequest, { foreignKey: 'requested_by_id', as: 'stockRequests' });
User.hasMany(StockRequest, { foreignKey: 'dispatched_by_id', as: 'dispatchedStockRequests' });
User.hasMany(StockRequest, { foreignKey: 'confirmed_by_id', as: 'confirmedStockRequests' });
User.hasMany(Sale, { foreignKey: 'created_by', as: 'sales' });
User.hasMany(Sale, { foreignKey: 'bill_confirmed_by_id', as: 'billConfirmedSales' });
User.hasMany(InventoryTransaction, { foreignKey: 'created_by', as: 'transactions' });
User.hasMany(StockReturn, { foreignKey: 'admin_id', as: 'returns' });
User.hasMany(StockReturn, { foreignKey: 'processed_by', as: 'processedReturns' });
User.hasMany(User, { foreignKey: 'created_by_id', as: 'createdUsers' });
User.belongsTo(User, { foreignKey: 'created_by_id', as: 'creator' });

// Product associations
Product.hasMany(AdminInventory, { foreignKey: 'product_id', as: 'adminInventory' });
Product.hasMany(InventoryTransaction, { foreignKey: 'product_id', as: 'transactions' });
Product.hasMany(StockReturn, { foreignKey: 'product_id', as: 'returns' });
Product.hasMany(StockRequestItem, { foreignKey: 'product_id', as: 'stockRequestItems' });
Product.hasMany(SaleItem, { foreignKey: 'product_id', as: 'saleItems' });
Product.hasMany(ProductSerialNumber, { foreignKey: 'product_id', as: 'serialNumbers' });
Product.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });

// AdminInventory associations
AdminInventory.belongsTo(User, { foreignKey: 'admin_id', as: 'admin' });
AdminInventory.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });

// StockRequest associations
StockRequest.belongsTo(Product, { foreignKey: 'primary_product_id', as: 'primaryProduct' });
StockRequest.belongsTo(User, { foreignKey: 'requested_by_id', as: 'requester' });
StockRequest.belongsTo(User, { foreignKey: 'dispatched_by_id', as: 'dispatcher' });
StockRequest.belongsTo(User, { foreignKey: 'confirmed_by_id', as: 'confirmer' });
StockRequest.hasMany(StockRequestItem, { foreignKey: 'stock_request_id', as: 'items', onDelete: 'CASCADE' });
StockRequestItem.belongsTo(StockRequest, { foreignKey: 'stock_request_id', as: 'stockRequest' });
StockRequestItem.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });

// Sale associations
Sale.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
Sale.belongsTo(User, { foreignKey: 'bill_confirmed_by_id', as: 'billConfirmer' });
Sale.belongsTo(Address, { foreignKey: 'billing_address_id', as: 'billingAddress' });
Sale.belongsTo(Address, { foreignKey: 'delivery_address_id', as: 'deliveryAddress' });
Sale.hasMany(SaleItem, { foreignKey: 'sale_id', as: 'items', onDelete: 'CASCADE' });
SaleItem.belongsTo(Sale, { foreignKey: 'sale_id', as: 'sale' });
SaleItem.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });

// Serial number associations
ProductSerialNumber.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });

// InventoryTransaction associations
InventoryTransaction.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });
InventoryTransaction.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
InventoryTransaction.belongsTo(StockRequest, { foreignKey: 'related_stock_request_id', as: 'relatedStockRequest' });
InventoryTransaction.belongsTo(Sale, { foreignKey: 'related_sale_id', as: 'relatedSale' });

// StockReturn associations
StockReturn.belongsTo(User, { foreignKey: 'admin_id', as: 'admin' });
StockReturn.belongsTo(User, { foreignKey: 'processed_by', as: 'processor' });
StockReturn.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });

// AccountManager associations
AccountManager.hasMany(AccountManagerHistory, { foreignKey: 'accountManagerId', as: 'history', onDelete: 'CASCADE' });
AccountManagerHistory.belongsTo(AccountManager, { foreignKey: 'accountManagerId', as: 'accountManager' });

// Calling lead module associations
CallingLead.hasOne(DealerLeadAssignment, { foreignKey: 'leadId', as: 'assignment', onDelete: 'CASCADE' });
DealerLeadAssignment.belongsTo(CallingLead, { foreignKey: 'leadId', as: 'lead' });
CallingLead.hasMany(CallingActionHistory, { foreignKey: 'leadId', as: 'actionHistory', onDelete: 'CASCADE' });
CallingActionHistory.belongsTo(CallingLead, { foreignKey: 'leadId', as: 'lead' });
CallingLeadUploadBatch.hasMany(CallingLeadUploadRow, { foreignKey: 'batchId', as: 'rows', onDelete: 'CASCADE' });
CallingLeadUploadRow.belongsTo(CallingLeadUploadBatch, { foreignKey: 'batchId', as: 'batch' });
CallingLeadUploadBatch.hasMany(CallingLead, { foreignKey: 'batchId', as: 'leads', onDelete: 'SET NULL' });
CallingLead.belongsTo(CallingLeadUploadBatch, { foreignKey: 'batchId', as: 'batch' });

// Sync database (use with caution in production)
export const syncDatabase = async (force: boolean = false): Promise<void> => {
  try {
    await sequelize.sync({ force });
    console.log('✅ Database models synchronized');
  } catch (error) {
    console.error('❌ Database sync error:', error);
  }
};

export {
  sequelize,
  User,
  Product,
  AdminInventory,
  StockRequest,
  StockRequestItem,
  Address,
  Sale,
  SaleItem,
  InventoryTransaction,
  StockReturn,
  ProductSerialNumber,
  AccountManager,
  AccountManagerHistory,
  CallingLead,
  DealerLeadAssignment,
  CallingActionHistory,
  CallingLeadUploadBatch,
  CallingLeadUploadRow,
  QuotationPaymentPhase,
  Review
};


