# Backend API Specification: Pricing Tables & System Configurations

**Priority:** HIGH  
**Status:** ⚠️ REQUIRED - Frontend is ready and depends on this API  
**Date:** December 30, 2025 (updated 8 Aug 2026)

**Seed from FE catalog:** [`BACKEND_PRICING_TABLES.md`](BACKEND_PRICING_TABLES.md) · payload [`BACKEND_PRICING_TABLES_SEED.json`](BACKEND_PRICING_TABLES_SEED.json) (from `lib/pricing-tables.ts`) · helpers [`BACKEND_PRICING_TABLES_SEED.ts`](BACKEND_PRICING_TABLES_SEED.ts)

---

## Overview

The frontend has been updated to fetch pricing tables and system configurations from the backend API. The backend must implement the Pricing Tables API endpoint to provide complete pricing data and system configuration presets to the frontend.

**IMPORTANT PRICING MODEL:**
- **Set Prices (DCR, NON DCR, BOTH)**: These are COMPLETE PACKAGE PRICES that include ALL components (panels, inverter, structure, meter, cables, ACDB, DCDB). The set price is the total project cost.
- **Individual Component Prices**: These are ONLY used when system type is "customize". For DCR/NON DCR/BOTH, the set price is used as-is without adding individual component prices.

---

## Required Endpoint

### GET /api/quotations/pricing-tables

**Purpose:** Fetch complete pricing tables and system configuration presets

**Method:** `GET`

**Authentication:** Required (Bearer token)

**Authorization:** Dealers, Admins, and Visitors

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "dcr": [
      {
        "systemSize": "3kW",
        "phase": "1-Phase",
        "inverterSize": "3kW",
        "panelType": "Adani",
        "price": 185000
      },
      {
        "systemSize": "3kW",
        "phase": "1-Phase",
        "inverterSize": "3kW",
        "panelType": "Waaree",
        "price": 185000
      },
      {
        "systemSize": "5kW",
        "phase": "1-Phase",
        "inverterSize": "5kW",
        "panelType": "Adani",
        "price": 300000
      }
      // ... more DCR pricing entries
    ],
    "nonDcr": [
      {
        "systemSize": "3kW",
        "phase": "1-Phase",
        "inverterSize": "3kW",
        "panelType": "Adani",
        "price": 200000
      }
      // ... more NON DCR pricing entries
    ],
    "both": [
      {
        "systemSize": "5kW",
        "phase": "3-Phase",
        "inverterSize": "5kW",
        "dcrCapacity": "3kW",
        "nonDcrCapacity": "2kW",
        "panelType": "Adani",
        "price": 260000
      }
      // ... more BOTH pricing entries
    ],
    "panels": [
      {
        "brand": "Adani",
        "size": "440W",
        "price": 25000
      },
      {
        "brand": "Adani",
        "size": "545W",
        "price": 31000
      },
      {
        "brand": "Tata",
        "size": "440W",
        "price": 26000
      }
      // ... more panel pricing entries
    ],
    "inverters": [
      {
        "brand": "Growatt",
        "size": "3kW",
        "price": 35000
      },
      {
        "brand": "Growatt",
        "size": "5kW",
        "price": 58000
      },
      {
        "brand": "Polycab",
        "size": "3kW",
        "price": 36000
      }
      // ... more inverter pricing entries
    ],
    "structures": [
      {
        "type": "GI Structure",
        "size": "1kW",
        "price": 8000
      },
      {
        "type": "GI Structure",
        "size": "3kW",
        "price": 24000
      },
      {
        "type": "Aluminum Structure",
        "size": "1kW",
        "price": 10000
      }
      // ... more structure pricing entries
    ],
    "meters": [
      {
        "brand": "L&T",
        "price": 5000
      },
      {
        "brand": "HPL",
        "price": 4800
      },
      {
        "brand": "Havells",
        "price": 5200
      }
      // ... more meter pricing entries
    ],
    "cables": [
      {
        "brand": "Polycab",
        "size": "4 sq mm",
        "type": "AC",
        "price": 3000
      },
      {
        "brand": "Polycab",
        "size": "6 sq mm",
        "type": "AC",
        "price": 3500
      },
      {
        "brand": "Polycab",
        "size": "4 sq mm",
        "type": "DC",
        "price": 3000
      }
      // ... more cable pricing entries
    ],
    "acdb": [
      {
        "option": "1-String",
        "price": 2500
      },
      {
        "option": "2-String",
        "price": 5000
      },
      {
        "option": "3-String",
        "price": 7500
      }
      // ... more ACDB pricing entries
    ],
    "dcdb": [
      {
        "option": "1-String",
        "price": 2500
      },
      {
        "option": "2-String",
        "price": 5000
      },
      {
        "option": "3-String",
        "price": 7500
      }
      // ... more DCDB pricing entries
    ],
    "systemConfigs": [
      {
        "systemType": "dcr",
        "systemSize": "3kW",
        "panelBrand": "Adani",
        "panelSize": "545W",
        "inverterBrand": "Polycab",
        "inverterSize": "3kW",
        "inverterType": "String Inverter",
        "structureType": "GI Structure",
        "structureSize": "3kW",
        "meterBrand": "Havells",
        "acCableBrand": "Polycab",
        "acCableSize": "6 sq mm",
        "dcCableBrand": "Polycab",
        "dcCableSize": "4 sq mm",
        "acdb": "1-String",
        "dcdb": "1-String"
      },
      {
        "systemType": "dcr",
        "systemSize": "5kW",
        "panelBrand": "Adani",
        "panelSize": "545W",
        "inverterBrand": "Polycab",
        "inverterSize": "5kW",
        "inverterType": "String Inverter",
        "structureType": "GI Structure",
        "structureSize": "5kW",
        "meterBrand": "Havells",
        "acCableBrand": "Polycab",
        "acCableSize": "6 sq mm",
        "dcCableBrand": "Polycab",
        "dcCableSize": "4 sq mm",
        "acdb": "2-String",
        "dcdb": "2-String"
      }
      // ... more system configuration presets
    ]
  }
}
```

**Response (401 Unauthorized):**
```json
{
  "success": false,
  "error": {
    "code": "AUTH_003",
    "message": "User not authenticated"
  }
}
```

**Response (500 Internal Server Error):**
```json
{
  "success": false,
  "error": {
    "code": "SYS_001",
    "message": "Internal server error"
  }
}
```

---

## Data Structure Requirements

### 1. System Pricing (DCR, NON DCR, BOTH)

**DCR Pricing:**
- `systemSize`: string (e.g., "3kW", "5kW", "10kW")
- `phase`: "1-Phase" | "3-Phase"
- `inverterSize`: string (e.g., "3kW", "5kW")
- `panelType`: string (e.g., "Adani", "Waaree", "Tata")
- `price`: number (**COMPLETE PACKAGE PRICE** - includes panels, inverter, structure, meter, cables, ACDB, DCDB)

**NON DCR Pricing:**
- Same structure as DCR pricing
- `price`: number (**COMPLETE PACKAGE PRICE** - includes all components)

**BOTH Pricing:**
- `systemSize`: string
- `phase`: "1-Phase" | "3-Phase"
- `inverterSize`: string
- `dcrCapacity`: string (e.g., "3kW")
- `nonDcrCapacity`: string (e.g., "2kW")
- `panelType`: string
- `price`: number (**COMPLETE PACKAGE PRICE** - includes all components)

### 2. Component Pricing

**Note:** Component prices are ONLY used when system type is "customize". For DCR/NON DCR/BOTH, the set price is used as the complete package price.

**Panels:**
- `brand`: string (e.g., "Adani", "Tata", "Waaree")
- `size`: string (e.g., "440W", "545W")
- `price`: number (price per panel - only used for "customize" system type)

**Inverters:**
- `brand`: string (e.g., "Growatt", "Polycab", "Solis")
- `size`: string (e.g., "3kW", "5kW", "10kW")
- `price`: number

**Structures:**
- `type`: string (e.g., "GI Structure", "Aluminum Structure", "MS Structure")
- `size`: string (e.g., "1kW", "3kW", "5kW")
- `price`: number

**Meters:**
- `brand`: string (e.g., "L&T", "HPL", "Havells")
- `price`: number

**Cables:**
- `brand`: string (e.g., "Polycab", "Havells", "KEI")
- `size`: string (e.g., "4 sq mm", "6 sq mm", "10 sq mm")
- `type`: "AC" | "DC"
- `price`: number

**ACDB:**
- `option`: string (e.g., "1-String", "2-String", "3-String")
- `price`: number

**DCDB:**
- `option`: string (e.g., "1-String", "2-String", "3-String")
- `price`: number

### 3. System Configuration Presets

**SystemConfigurationPreset:**
- `systemType`: "dcr" | "non-dcr" | "both"
- `systemSize`: string (e.g., "3kW", "5kW")
- `panelBrand`: string
- `panelSize`: string
- `inverterBrand`: string
- `inverterSize`: string
- `inverterType`: string
- `structureType`: string
- `structureSize`: string
- `meterBrand`: string
- `acCableBrand`: string
- `acCableSize`: string
- `dcCableBrand`: string
- `dcCableSize`: string
- `acdb`: string
- `dcdb`: string

---

## Database Schema Recommendations

### Option 1: Single JSON Configuration Table (Recommended)

```sql
CREATE TABLE IF NOT EXISTS pricing_config (
  id SERIAL PRIMARY KEY,
  config_key VARCHAR(50) UNIQUE NOT NULL,
  config_value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pricing_config_key ON pricing_config(config_key);
```

**Usage:**
- `config_key`: `'pricing_tables'`
- `config_value`: Complete pricing tables JSON object (as shown in response)

### Option 2: Separate Tables (More Normalized)

```sql
-- System Pricing Tables
CREATE TABLE IF NOT EXISTS dcr_pricing (
  id SERIAL PRIMARY KEY,
  system_size VARCHAR(10) NOT NULL,
  phase VARCHAR(10) NOT NULL,
  inverter_size VARCHAR(10) NOT NULL,
  panel_type VARCHAR(50) NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(system_size, phase, inverter_size, panel_type)
);

CREATE TABLE IF NOT EXISTS non_dcr_pricing (
  -- Same structure as dcr_pricing
);

CREATE TABLE IF NOT EXISTS both_pricing (
  id SERIAL PRIMARY KEY,
  system_size VARCHAR(10) NOT NULL,
  phase VARCHAR(10) NOT NULL,
  inverter_size VARCHAR(10) NOT NULL,
  dcr_capacity VARCHAR(10) NOT NULL,
  non_dcr_capacity VARCHAR(10) NOT NULL,
  panel_type VARCHAR(50) NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Component Pricing Tables
CREATE TABLE IF NOT EXISTS panel_pricing (
  id SERIAL PRIMARY KEY,
  brand VARCHAR(50) NOT NULL,
  size VARCHAR(10) NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(brand, size)
);

CREATE TABLE IF NOT EXISTS inverter_pricing (
  id SERIAL PRIMARY KEY,
  brand VARCHAR(50) NOT NULL,
  size VARCHAR(10) NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(brand, size)
);

CREATE TABLE IF NOT EXISTS structure_pricing (
  id SERIAL PRIMARY KEY,
  type VARCHAR(50) NOT NULL,
  size VARCHAR(10) NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(type, size)
);

CREATE TABLE IF NOT EXISTS meter_pricing (
  id SERIAL PRIMARY KEY,
  brand VARCHAR(50) UNIQUE NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cable_pricing (
  id SERIAL PRIMARY KEY,
  brand VARCHAR(50) NOT NULL,
  size VARCHAR(20) NOT NULL,
  type VARCHAR(2) NOT NULL CHECK (type IN ('AC', 'DC')),
  price DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(brand, size, type)
);

CREATE TABLE IF NOT EXISTS acdb_pricing (
  id SERIAL PRIMARY KEY,
  option VARCHAR(20) UNIQUE NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dcdb_pricing (
  id SERIAL PRIMARY KEY,
  option VARCHAR(20) UNIQUE NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- System Configuration Presets
CREATE TABLE IF NOT EXISTS system_config_presets (
  id SERIAL PRIMARY KEY,
  system_type VARCHAR(10) NOT NULL CHECK (system_type IN ('dcr', 'non-dcr', 'both')),
  system_size VARCHAR(10) NOT NULL,
  panel_brand VARCHAR(50) NOT NULL,
  panel_size VARCHAR(10) NOT NULL,
  inverter_brand VARCHAR(50) NOT NULL,
  inverter_size VARCHAR(10) NOT NULL,
  inverter_type VARCHAR(50) NOT NULL,
  structure_type VARCHAR(50) NOT NULL,
  structure_size VARCHAR(10) NOT NULL,
  meter_brand VARCHAR(50) NOT NULL,
  ac_cable_brand VARCHAR(50) NOT NULL,
  ac_cable_size VARCHAR(20) NOT NULL,
  dc_cable_brand VARCHAR(50) NOT NULL,
  dc_cable_size VARCHAR(20) NOT NULL,
  acdb VARCHAR(20) NOT NULL,
  dcdb VARCHAR(20) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## Implementation Checklist

### GET /api/quotations/pricing-tables

- [ ] Route handler created
- [ ] Authentication middleware applied
- [ ] Authorization: Allow dealers, admins, and visitors
- [ ] Database query to fetch all pricing data
- [ ] Response format matches specification exactly
- [ ] All arrays are arrays (never `null` or `undefined`)
- [ ] Arrays can be empty `[]` if no data exists
- [ ] Error handling implemented
- [ ] **CRITICAL:** Frontend product selection form depends on this endpoint

### Database Setup

- [ ] Choose database schema approach (JSON config table or normalized tables)
- [ ] Create necessary tables
- [ ] Insert initial pricing data (seed script)
- [ ] Create indexes for performance
- [ ] Set up foreign keys if using normalized approach

### Data Seeding

- [ ] Seed DCR pricing data
- [ ] Seed NON DCR pricing data
- [ ] Seed BOTH pricing data
- [ ] Seed component pricing (panels, inverters, structures, meters, cables, ACDB, DCDB)
- [ ] Seed system configuration presets
- [ ] Verify all data matches frontend expectations

### Testing

- [ ] Test endpoint returns correct structure
- [ ] Test with authenticated user
- [ ] Test with unauthenticated user (should return 401)
- [ ] Test with empty database (should return empty arrays)
- [ ] Test response format matches TypeScript interfaces
- [ ] Test all pricing categories are present
- [ ] Test system configuration presets are complete

---

## Example Backend Implementation (Node.js/Express)

```javascript
// GET /api/quotations/pricing-tables
router.get('/quotations/pricing-tables', authenticate, async (req, res) => {
  try {
    // Option 1: Fetch from JSON config table
    const config = await db.query(
      'SELECT config_value FROM pricing_config WHERE config_key = $1',
      ['pricing_tables']
    );
    
    if (config.rows.length === 0) {
      // Return empty structure if no data
      return res.json({
        success: true,
        data: {
          dcr: [],
          nonDcr: [],
          both: [],
          panels: [],
          inverters: [],
          structures: [],
          meters: [],
          cables: [],
          acdb: [],
          dcdb: [],
          systemConfigs: []
        }
      });
    }
    
    const pricingData = config.rows[0].config_value;
    
    res.json({
      success: true,
      data: pricingData
    });
    
  } catch (error) {
    console.error('Error fetching pricing tables:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SYS_001',
        message: 'Internal server error'
      }
    });
  }
});
```

---

## Notes

1. **Pricing Model - CRITICAL:**
   - **Set Prices (DCR, NON DCR, BOTH)**: These are COMPLETE PACKAGE PRICES that include ALL components:
     - Panels
     - Inverter
     - Structure
     - Meter
     - AC & DC Cables
     - ACDB & DCDB
     - Basic installation
   - The set price is the TOTAL PROJECT COST (subtotal) - do NOT add individual component prices on top
   - **Individual Component Prices**: Only used when system type is "customize"
   - For customize: Calculate subtotal = sum of all individual component prices

2. **Data Format:** All pricing values should be numbers (not strings)

3. **Arrays:** All arrays must be arrays, never `null` or `undefined`. Empty arrays `[]` are acceptable.

4. **System Configs:** The `systemConfigs` array is critical for the dropdown functionality in the frontend

5. **Updates:** When pricing is updated, the frontend will automatically use the new data on next page load

6. **Caching:** Consider implementing caching for this endpoint as pricing data doesn't change frequently

7. **Versioning:** Consider adding version numbers to track pricing table updates

---

## Frontend Integration

The frontend will:
1. Call `GET /api/quotations/pricing-tables` on component mount
2. Cache the data globally using `usePricingTables` hook
3. Use the data to:
   - Populate dropdown options for system configurations
   - Calculate prices for components
   - Pre-fill form fields when a configuration is selected
4. Fall back to hardcoded values if API is unavailable
5. **Admin → Pricing** tab calls `PUT /api/quotations/pricing-tables` to persist edits; dealers download the same DCR table as PDF from Calling Data

---

## PUT /api/quotations/pricing-tables (Admin)

**Purpose:** Persist package set prices edited in Admin → Pricing (same payload shape as GET `data`).

**Method:** `PUT`

**Authentication:** Required (Bearer token)

**Authorization:** Admin only

**Request body:** Same object as GET `data` (full or partial replace of top-level keys):

```json
{
  "dcr": [
    {
      "systemSize": "3kW",
      "phase": "1-Phase",
      "inverterSize": "3kW",
      "panelType": "Waaree Topcon",
      "price": 190000
    }
  ],
  "nonDcr": [],
  "both": [],
  "panels": [],
  "inverters": [],
  "structures": [],
  "meters": [],
  "cables": [],
  "acdb": [],
  "dcdb": [],
  "systemConfigs": []
}
```

**Recommended behavior:**
1. Store JSON document (e.g. `pricing_config` table / key-value) so the next `GET` returns admin values.
2. Admin UI: Add/Delete are **draft-only**; only **Save** calls PUT with **full** `dcr` + `nonDcr` + `both` arrays — **replace** each array key that is present (do not append).
3. Return `{ "success": true, "data": <saved PricingTablesData> }` matching GET.
4. Reject non-admin with 403.
5. Implement handlers from `BACKEND_PRICING_TABLES_CONTROLLER.ts` (see also `BACKEND_PRICING_TABLES.md`).

**Frontend client:** `api.quotations.updatePricingTables(body)` in `lib/api.ts`.

**Checklist:**
- [ ] `PUT /api/quotations/pricing-tables` admin-only
- [ ] Persist to DB; `GET` returns saved `dcr` / `nonDcr` / `both` (and other keys)
- [ ] Seed initial rows from current Aug 2026 DCR matrix (incl. Waaree Topcon 610W)
- [ ] Smoke: Admin edit/add/delete → Save → GET reflects all three tables

---

## Priority

**HIGH PRIORITY** - The frontend product selection form now depends on this endpoint. Without it, users cannot use the quick-select dropdown feature for pre-configured systems. Admin price editing and dealer pricing PDF depend on GET + PUT.

