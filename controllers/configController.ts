import { Request, Response } from 'express';
import { SystemConfig } from '../models/index-quotation';
import { logError, logInfo } from '../utils/loggerHelper';
import { pricingTablesSchema } from '../validations/pricingValidations';
import {
  JUNE_2026_PRICING_META,
  mergeDefaultDcrPricing,
  mergeDefaultSystemConfigs
} from '../utils/defaultPricingTables';
import { normalizeProductCatalog } from '../utils/productCatalogNormalize';

// Get product catalog
export const getProductCatalog = async (_req: Request, res: Response): Promise<void> => {
  try {
    const config = await SystemConfig.findByPk('product_catalog');

    if (!config) {
      // Return default empty structure if no config exists
      const defaultCatalog = normalizeProductCatalog(null);

      res.json({
        success: true,
        data: defaultCatalog
      });
      return;
    }

    // Parse JSON from configValue
    let catalog;
    try {
      catalog = typeof config.configValue === 'string' 
        ? JSON.parse(config.configValue) 
        : config.configValue;
    } catch (parseError) {
      logError('Failed to parse product catalog JSON', parseError);
      res.status(500).json({
        success: false,
        error: { code: 'SYS_001', message: 'Internal server error' }
      });
      return;
    }

    // Normalize catalog to ensure all arrays are arrays (never null/undefined)
    const normalizedCatalog = normalizeProductCatalog(catalog);

    res.json({
      success: true,
      data: normalizedCatalog
    });
  } catch (error) {
    logError('Get product catalog error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Update product catalog
export const updateProductCatalog = async (req: Request, res: Response): Promise<void> => {
  try {
    const productCatalog = req.body;
    const userId = req.dealer?.id || req.user?.id;

    // Basic structure validation (detailed validation is done by middleware)
    if (!productCatalog || typeof productCatalog !== 'object') {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Validation error',
          details: [{ field: 'body', message: 'Invalid request body' }]
        }
      });
      return;
    }

    // Validate required categories exist
    const requiredCategories = ['panels', 'inverters', 'structures', 'meters', 'cables', 'acdb', 'dcdb'];
    const missingCategories = requiredCategories.filter(cat => !productCatalog[cat]);
    
    if (missingCategories.length > 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Validation error',
          details: missingCategories.map(cat => ({
            field: cat,
            message: `Missing required category: ${cat}`
          }))
        }
      });
      return;
    }

    // Validate array fields (additional validation beyond schema)
    const validationErrors: Array<{ field: string; message: string }> = [];
    
    // Helper function to validate array field
    const validateArray = (path: string, value: any, fieldName: string): boolean => {
      if (!Array.isArray(value)) {
        validationErrors.push({
          field: path,
          message: `${fieldName} must be an array`
        });
        return false;
      }
      if (value.length === 0) {
        validationErrors.push({
          field: path,
          message: `At least one ${fieldName.toLowerCase()} is required`
        });
        return false;
      }
      // Validate each item is a non-empty string
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] !== 'string' || value[i].trim().length === 0) {
          validationErrors.push({
            field: `${path}[${i}]`,
            message: `${fieldName} items must be non-empty strings`
          });
          return false;
        }
      }
      return true;
    };

    // Validate all fields
    validateArray('panels.brands', productCatalog.panels?.brands, 'Panel brands');
    validateArray('panels.sizes', productCatalog.panels?.sizes, 'Panel sizes');
    validateArray('inverters.types', productCatalog.inverters?.types, 'Inverter types');
    validateArray('inverters.brands', productCatalog.inverters?.brands, 'Inverter brands');
    validateArray('inverters.sizes', productCatalog.inverters?.sizes, 'Inverter sizes');
    validateArray('structures.types', productCatalog.structures?.types, 'Structure types');
    validateArray('structures.sizes', productCatalog.structures?.sizes, 'Structure sizes');
    validateArray('meters.brands', productCatalog.meters?.brands, 'Meter brands');
    validateArray('cables.brands', productCatalog.cables?.brands, 'Cable brands');
    validateArray('cables.sizes', productCatalog.cables?.sizes, 'Cable sizes');
    validateArray('acdb.options', productCatalog.acdb?.options, 'ACDB options');
    validateArray('dcdb.options', productCatalog.dcdb?.options, 'DCDB options');

    if (validationErrors.length > 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Validation error',
          details: validationErrors
        }
      });
      return;
    }

    // Store in system_config table
    const configKey = 'product_catalog';
    const configValue = JSON.stringify(productCatalog);
    const dataType = 'json';

    // Check if config exists
    const existingConfig = await SystemConfig.findByPk(configKey);

    if (existingConfig) {
      // Update existing config
      await existingConfig.update({
        configValue,
        dataType,
        updatedAt: new Date()
      });
    } else {
      // Create new config
      await SystemConfig.create({
        configKey,
        configValue,
        dataType,
        description: 'Product catalog configuration',
        category: 'product',
        updatedAt: new Date()
      });
    }

    logInfo('Product catalog updated', {
      updatedBy: userId,
      timestamp: new Date().toISOString()
    });

    // Return success with the same data structure
    res.json({
      success: true,
      message: 'Product catalog updated successfully',
      data: productCatalog
    });
  } catch (error) {
    logError('Update product catalog error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Get Indian states
export const getIndianStates = async (_req: Request, res: Response): Promise<void> => {
  try {
    const states = [
      'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
      'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
      'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
      'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
      'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
      'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
      'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
      'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'
    ];

    res.json({
      success: true,
      data: { states }
    });
  } catch (error) {
    logError('Get Indian states error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Helper function to normalize pricing tables data
const normalizePricingTables = (pricing: any): any => {
  return {
    panels: Array.isArray(pricing?.panels) ? pricing.panels : [],
    inverters: Array.isArray(pricing?.inverters) ? pricing.inverters : [],
    structures: Array.isArray(pricing?.structures) ? pricing.structures : [],
    meters: Array.isArray(pricing?.meters) ? pricing.meters : [],
    cables: Array.isArray(pricing?.cables) ? pricing.cables : [],
    acdb: Array.isArray(pricing?.acdb) ? pricing.acdb : [],
    dcdb: Array.isArray(pricing?.dcdb) ? pricing.dcdb : [],
    dcr: mergeDefaultDcrPricing(pricing?.dcr),
    nonDcr: Array.isArray(pricing?.nonDcr) ? pricing.nonDcr : [],
    both: Array.isArray(pricing?.both) ? pricing.both : [],
    systemConfigs: mergeDefaultSystemConfigs(pricing?.systemConfigs),
    effectiveFrom: pricing?.effectiveFrom ?? JUNE_2026_PRICING_META.effectiveFrom,
    effectiveTo: pricing?.effectiveTo ?? JUNE_2026_PRICING_META.effectiveTo,
    effective_from: pricing?.effective_from ?? JUNE_2026_PRICING_META.effectiveFrom,
    effective_to: pricing?.effective_to ?? JUNE_2026_PRICING_META.effectiveTo
  };
};

// Get pricing tables
export const getPricingTables = async (_req: Request, res: Response): Promise<void> => {
  try {
    const config = await SystemConfig.findByPk('pricing_tables');

    if (!config) {
      // Return default empty structure if no config exists
      const defaultPricing = normalizePricingTables(null);

      res.json({
        success: true,
        data: defaultPricing
      });
      return;
    }

    // Parse JSON from configValue
    let pricing;
    try {
      pricing = typeof config.configValue === 'string' 
        ? JSON.parse(config.configValue) 
        : config.configValue;
    } catch (parseError) {
      logError('Failed to parse pricing tables JSON', parseError);
      res.status(500).json({
        success: false,
        error: { code: 'SYS_001', message: 'Internal server error' }
      });
      return;
    }

    // Normalize pricing to ensure all arrays are arrays
    const normalizedPricing = normalizePricingTables(pricing);

    res.json({
      success: true,
      data: normalizedPricing
    });
  } catch (error) {
    logError('Get pricing tables error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

// Update pricing tables
export const updatePricingTables = async (req: Request, res: Response): Promise<void> => {
  try {
    const pricingTables = req.body;
    const userId = req.dealer?.id || req.user?.id;

    // Basic structure validation (detailed validation is done by middleware)
    if (!pricingTables || typeof pricingTables !== 'object') {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Validation error',
          details: [{ field: 'body', message: 'Invalid request body' }]
        }
      });
      return;
    }

    // Validate using Zod schema (validation middleware should have caught this, but double-check)
    try {
      pricingTablesSchema.parse(pricingTables);
    } catch (validationError: any) {
      if (validationError.errors) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_001',
            message: 'Validation error',
            details: validationError.errors.map((err: any) => ({
              field: err.path.join('.'),
              message: err.message
            }))
          }
        });
        return;
      }
    }

    // Store in system_config table
    const configKey = 'pricing_tables';
    const configValue = JSON.stringify(pricingTables);
    const dataType = 'json';

    // Check if config exists
    const existingConfig = await SystemConfig.findByPk(configKey);

    if (existingConfig) {
      // Update existing config
      await existingConfig.update({
        configValue,
        dataType,
        updatedAt: new Date()
      });
    } else {
      // Create new config
      await SystemConfig.create({
        configKey,
        configValue,
        dataType,
        description: 'Pricing tables for solar systems and components',
        category: 'pricing',
        updatedAt: new Date()
      });
    }

    logInfo('Pricing tables updated', {
      updatedBy: userId,
      timestamp: new Date().toISOString()
    });

    // Return success with normalized data
    const normalizedPricing = normalizePricingTables(pricingTables);
    res.json({
      success: true,
      message: 'Pricing tables updated successfully',
      data: normalizedPricing
    });
  } catch (error) {
    logError('Update pricing tables error', error);
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};


