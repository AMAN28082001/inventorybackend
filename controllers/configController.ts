import { Request, Response } from 'express';
import { SystemConfig } from '../models/index-quotation';
import { logError, logInfo } from '../utils/loggerHelper';
import { pricingTablesSchema } from '../validations/pricingValidations';
import {
  JUNE_2026_PRICING_META,
  mergeDefaultDcrPricing,
  mergeDefaultNonDcrPricing,
  mergeDefaultBothPricing,
  mergeDefaultSystemConfigs,
  buildDcrPricingMatrix,
  ensureNonDcrWaaree125KwPricing,
  ensureNonDcrWaaree125KwSystemConfigs
} from '../utils/defaultPricingTables';
import { normalizeProductCatalog } from '../utils/productCatalogNormalize';
import {
  loadPricingTablesSeed,
  mergePricingTablesPayload,
  normalizePricingTablesPayload
} from '../utils/pricingTablesSeed';

const CONFIG_CACHE_TTL_MS = 60 * 1000;
let productCatalogCache: { value: any; expiresAt: number } | null = null;
let pricingTablesCache: { value: any; expiresAt: number } | null = null;

// Get product catalog
export const getProductCatalog = async (_req: Request, res: Response): Promise<void> => {
  try {
    const now = Date.now();
    if (productCatalogCache && productCatalogCache.expiresAt > now) {
      res.json({
        success: true,
        data: productCatalogCache.value
      });
      return;
    }

    const config = await SystemConfig.findByPk('product_catalog');

    if (!config) {
      // Return default empty structure if no config exists
      const defaultCatalog = normalizeProductCatalog(null);

      productCatalogCache = {
        value: defaultCatalog,
        expiresAt: now + CONFIG_CACHE_TTL_MS
      };
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
    productCatalogCache = {
      value: normalizedCatalog,
      expiresAt: now + CONFIG_CACHE_TTL_MS
    };

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

    productCatalogCache = null;

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
  const seed = (() => {
    try {
      return loadPricingTablesSeed();
    } catch {
      return null;
    }
  })();
  const pickComponents = (key: keyof NonNullable<typeof seed>, fallback: unknown) => {
    // Array present (including []) = Admin Save replaced it — do not refill from seed
    if (Array.isArray(pricing?.[key])) return pricing[key];
    if (seed && Array.isArray(seed[key]) && (seed[key] as unknown[]).length > 0) return seed[key];
    return Array.isArray(fallback) ? fallback : [];
  };
  const systemConfigs = mergeDefaultSystemConfigs(
    pricing?.systemConfigs ?? pricing?.systemConfigurations
  );
  const dcr = mergeDefaultDcrPricing(pricing?.dcr);
  const dcrMatrix = buildDcrPricingMatrix(dcr);
  const meta = pricing?.meta || seed?.meta || {};
  const effectiveFrom =
    pricing?.effectiveFrom ??
    meta.effectiveFrom ??
    seed?.meta?.effectiveFrom ??
    JUNE_2026_PRICING_META.effectiveFrom;
  const effectiveTo =
    pricing?.effectiveTo ??
    pricing?.validTill ??
    meta.validTill ??
    seed?.meta?.validTill ??
    JUNE_2026_PRICING_META.effectiveTo;
  return {
    panels: pickComponents('panels', pricing?.panels),
    inverters: pickComponents('inverters', pricing?.inverters),
    structures: pickComponents('structures', pricing?.structures),
    meters: pickComponents('meters', pricing?.meters),
    cables: pickComponents('cables', pricing?.cables),
    acdb: pickComponents('acdb', pricing?.acdb),
    dcdb: pickComponents('dcdb', pricing?.dcdb),
    dcr,
    dcrMatrix,
    nonDcr: mergeDefaultNonDcrPricing(pricing?.nonDcr),
    both: mergeDefaultBothPricing(pricing?.both),
    systemConfigs,
    systemConfigurations: systemConfigs,
    meta: {
      effectiveFrom,
      validTill: effectiveTo,
      panelTypes: meta.panelTypes || seed?.meta?.panelTypes
    },
    effectiveFrom,
    effectiveTo,
    validTill: effectiveTo,
    effective_from: effectiveFrom,
    effective_to: effectiveTo
  };
};

// Get pricing tables
export const getPricingTables = async (_req: Request, res: Response): Promise<void> => {
  try {
    const now = Date.now();
    if (pricingTablesCache && pricingTablesCache.expiresAt > now) {
      res.json({
        success: true,
        data: pricingTablesCache.value
      });
      return;
    }

    const config = await SystemConfig.findByPk('pricing_tables');

    if (!config) {
      // Return default empty structure if no config exists
      const defaultPricing = normalizePricingTables(null);

      pricingTablesCache = {
        value: defaultPricing,
        expiresAt: now + CONFIG_CACHE_TTL_MS
      };
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
    pricingTablesCache = {
      value: normalizedPricing,
      expiresAt: now + CONFIG_CACHE_TTL_MS
    };

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

// Update pricing tables (Admin → Pricing → Save)
// Add/Delete are FE draft-only; Save sends full dcr+nonDcr+both and we REPLACE those arrays.
export const updatePricingTables = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawBody = req.body;
    const userId = req.dealer?.id || req.user?.id;

    if (!rawBody || typeof rawBody !== 'object') {
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

    const pricingTables =
      (rawBody as any).data && typeof (rawBody as any).data === 'object'
        ? (rawBody as any).data
        : rawBody;

    const hasDcr = Array.isArray(pricingTables.dcr);
    const hasNonDcr = Array.isArray(pricingTables.nonDcr);
    const hasBoth = Array.isArray(pricingTables.both);
    if (!hasDcr && !hasNonDcr && !hasBoth) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Body must include at least one of: dcr, nonDcr, both (arrays)',
          details: [
            { field: 'dcr', message: 'array of package rows' },
            { field: 'nonDcr', message: 'array of package rows' },
            { field: 'both', message: 'array of package rows' }
          ]
        }
      });
      return;
    }

    const validateSystemRows = (rows: unknown, field: string) => {
      if (!Array.isArray(rows)) return null;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] as Record<string, unknown>;
        if (!row || typeof row !== 'object') {
          return { field: `${field}[${i}]`, message: 'row must be an object' };
        }
        if (!String(row.systemSize || '').trim()) {
          return { field: `${field}[${i}].systemSize`, message: 'required' };
        }
        if (!String(row.panelType || '').trim()) {
          return { field: `${field}[${i}].panelType`, message: 'required' };
        }
        if (!Number.isFinite(Number(row.price))) {
          return { field: `${field}[${i}].price`, message: 'must be a number' };
        }
      }
      return null;
    };
    for (const field of ['dcr', 'nonDcr', 'both'] as const) {
      const err = validateSystemRows(pricingTables[field], field);
      if (err) {
        res.status(400).json({
          success: false,
          error: { code: 'VAL_001', message: err.message, details: [err] }
        });
        return;
      }
    }

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

    const configKey = 'pricing_tables';
    const existingConfig = await SystemConfig.findByPk(configKey);
    let existingPayload: unknown = null;
    if (existingConfig) {
      try {
        existingPayload =
          typeof existingConfig.configValue === 'string'
            ? JSON.parse(existingConfig.configValue)
            : existingConfig.configValue;
      } catch {
        existingPayload = null;
      }
    }

    const base =
      existingPayload && typeof existingPayload === 'object'
        ? normalizePricingTablesPayload(existingPayload)
        : loadPricingTablesSeed();
    // Replace each array key present in body (do not append). Unspecified keys kept from base.
    const merged = mergePricingTablesPayload(base, pricingTables);
    merged.nonDcr = ensureNonDcrWaaree125KwPricing(merged.nonDcr || []);
    merged.systemConfigs = ensureNonDcrWaaree125KwSystemConfigs(
      (merged.systemConfigs || []) as Array<{
        systemType?: string;
        systemSize?: string;
        phase?: string;
        panelBrand?: string;
      }>
    );
    const configValue = JSON.stringify(merged);

    if (existingConfig) {
      await existingConfig.update({
        configValue,
        dataType: 'json',
        updatedAt: new Date()
      });
    } else {
      await SystemConfig.create({
        configKey,
        configValue,
        dataType: 'json',
        description: 'Pricing tables for solar systems and components (Aug 2026 FE seed)',
        category: 'pricing',
        updatedAt: new Date()
      });
    }

    pricingTablesCache = null;

    logInfo('Pricing tables updated', {
      updatedBy: userId,
      timestamp: new Date().toISOString(),
      dcrCount: merged.dcr.length,
      nonDcrCount: merged.nonDcr.length,
      bothCount: merged.both.length
    });

    // Echo same shape as GET so Admin draft + next GET stay in sync
    const normalizedPricing = normalizePricingTables(merged);
    pricingTablesCache = {
      value: normalizedPricing,
      expiresAt: Date.now() + CONFIG_CACHE_TTL_MS
    };
    res.json({
      success: true,
      message: 'Pricing tables updated successfully',
      data: normalizedPricing
    });
  } catch (error) {
    logError('Update pricing tables error', error);
    res.status(500).json({
      success: false,
      error: { code: 'PRICING_002', message: 'Failed to save pricing tables' }
    });
  }
};


