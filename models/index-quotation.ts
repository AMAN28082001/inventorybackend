import sequelize from '../config/database';

// Import all quotation system models
import Dealer from './Dealer';
import Visitor from './Visitor';
import Customer from './Customer';
import Quotation from './Quotation';
import QuotationPaymentPhase from './QuotationPaymentPhase';
import QuotationProduct from './QuotationProduct';
import CustomPanel from './CustomPanel';
import QuotationDocument from './QuotationDocument';
import QuotationInstallationDoc from './QuotationInstallationDoc';
import Visit from './Visit';
import VisitAssignment from './VisitAssignment';
import ProductCatalog from './ProductCatalog';
import PricingRule from './PricingRule';
import SystemConfig from './SystemConfig';
import DealerRequest from './DealerRequest';

// ================================================================================
// DEALER ASSOCIATIONS
// ================================================================================
// Dealers create customers
Dealer.hasMany(Customer, { foreignKey: 'dealerId', as: 'customers' });
Customer.belongsTo(Dealer, { foreignKey: 'dealerId', as: 'dealer' });

// Dealers create quotations
Dealer.hasMany(Quotation, { foreignKey: 'dealerId', as: 'quotations' });
Quotation.belongsTo(Dealer, { foreignKey: 'dealerId', as: 'dealer' });

// Dealers create visits
Dealer.hasMany(Visit, { foreignKey: 'dealerId', as: 'visits' });
Visit.belongsTo(Dealer, { foreignKey: 'dealerId', as: 'dealer' });

// Dealers can be assigned incoming requests
Dealer.hasMany(DealerRequest, { foreignKey: 'assignedDealerId', as: 'assignedRequests' });
DealerRequest.belongsTo(Dealer, { foreignKey: 'assignedDealerId', as: 'assignedDealer' });

// ================================================================================
// CUSTOMER ASSOCIATIONS
// ================================================================================
// Customers have quotations
Customer.hasMany(Quotation, { foreignKey: 'customerId', as: 'quotations' });
Quotation.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });

// ================================================================================
// QUOTATION ASSOCIATIONS
// ================================================================================
// Quotations have one product configuration (1:1)
Quotation.hasOne(QuotationProduct, { foreignKey: 'quotationId', as: 'products', onDelete: 'CASCADE' });
QuotationProduct.belongsTo(Quotation, { foreignKey: 'quotationId', as: 'quotation' });

// Quotations have multiple payment phases (1:N)
Quotation.hasMany(QuotationPaymentPhase, { foreignKey: 'quotationId', as: 'paymentPhaseRows', onDelete: 'CASCADE' });
QuotationPaymentPhase.belongsTo(Quotation, { foreignKey: 'quotationId', as: 'quotation' });

// Quotations have one documents record (1:1)
Quotation.hasOne(QuotationDocument, { foreignKey: 'quotationId', as: 'documents', onDelete: 'CASCADE' });
QuotationDocument.belongsTo(Quotation, { foreignKey: 'quotationId', as: 'quotation' });

// Quotations can have multiple installation workflow documents (1:N)
Quotation.hasMany(QuotationInstallationDoc, { foreignKey: 'quotationId', as: 'installationDocs', onDelete: 'CASCADE' });
QuotationInstallationDoc.belongsTo(Quotation, { foreignKey: 'quotationId', as: 'quotation' });

// Quotations can have multiple custom panels (1:N)
Quotation.hasMany(CustomPanel, { foreignKey: 'quotationId', as: 'customPanels', onDelete: 'CASCADE' });
CustomPanel.belongsTo(Quotation, { foreignKey: 'quotationId', as: 'quotation' });

// Quotations can have multiple visits (1:N)
Quotation.hasMany(Visit, { foreignKey: 'quotationId', as: 'visits', onDelete: 'CASCADE' });
Visit.belongsTo(Quotation, { foreignKey: 'quotationId', as: 'quotation' });

// ================================================================================
// VISIT ASSOCIATIONS
// ================================================================================
// Visits have multiple visitor assignments (1:N)
Visit.hasMany(VisitAssignment, { foreignKey: 'visitId', as: 'assignments', onDelete: 'CASCADE' });
VisitAssignment.belongsTo(Visit, { foreignKey: 'visitId', as: 'visit' });

// ================================================================================
// VISITOR ASSOCIATIONS
// ================================================================================
// Visitors can be assigned to multiple visits (N:M through visit_assignments)
Visitor.hasMany(VisitAssignment, { foreignKey: 'visitorId', as: 'assignments' });
VisitAssignment.belongsTo(Visitor, { foreignKey: 'visitorId', as: 'visitor' });

// ================================================================================
// SYNC DATABASE
// ================================================================================
export const syncDatabase = async (force: boolean = false): Promise<void> => {
  try {
    await sequelize.sync({ force });
    console.log('✅ Database models synchronized');
  } catch (error) {
    console.error('❌ Database sync error:', error);
    throw error;
  }
};

// Export all models
export {
  sequelize,
  Dealer,
  Visitor,
  Customer,
  Quotation,
  QuotationPaymentPhase,
  QuotationProduct,
  CustomPanel,
  QuotationDocument,
  QuotationInstallationDoc,
  Visit,
  VisitAssignment,
  ProductCatalog,
  PricingRule,
  SystemConfig,
  DealerRequest
};

