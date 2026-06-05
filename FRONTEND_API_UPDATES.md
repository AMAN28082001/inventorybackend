# Frontend API Updates - Quotation Editing

## Overview
New backend endpoints have been added to support editing quotations. The frontend can now persist changes to system configuration and pricing.

## New Endpoints

### 1. Update Quotation Products/System Configuration
**Endpoint**: `PATCH /api/quotations/{quotationId}/products`

**Purpose**: Update the system configuration and product details for a quotation.

**Request Body**:
```typescript
{
  products: {
    systemType?: "dcr" | "non-dcr" | "both" | "customize" | "on-grid" | "off-grid" | "hybrid",
    
    // For DCR/NON-DCR/BOTH (non-customize)
    panelBrand?: string,
    panelSize?: string,
    panelQuantity?: number,
    
    // For BOTH system type
    dcrPanelBrand?: string,
    dcrPanelSize?: string,
    dcrPanelQuantity?: number,
    nonDcrPanelBrand?: string,
    nonDcrPanelSize?: string,
    nonDcrPanelQuantity?: number,
    
    // For CUSTOMIZE system type
    customPanels?: Array<{
      brand: string,
      size: string,
      quantity: number,
      type: "dcr" | "non-dcr",
      price: number
    }>,
    
    // Common fields
    inverterBrand?: string,
    inverterType?: string,
    inverterSize?: string,
    structureType?: string,
    structureSize?: string,
    meterBrand?: string,
    batteryCapacity?: string,
    acCableBrand?: string,
    acCableSize?: string,
    dcCableBrand?: string,
    dcCableSize?: string,
    acdb?: string,
    dcdb?: string,
    hybridInverter?: string,
    batteryPrice?: number
  }
}
```

**Response** (200 OK):
```typescript
{
  success: true,
  data: {
    id: string,
    systemType: string,
    products: {
      // Updated products object
      customPanels?: Array<{...}>
    },
    updatedAt: string
  }
}
```

**Example Usage**:
```typescript
// In your API client (lib/api.ts)
quotations: {
  // ... existing methods ...
  
  updateProducts: async (quotationId: string, products: any) => {
    return apiRequest(`/quotations/${quotationId}/products`, {
      method: "PATCH",
      body: { products },
    })
  },
}

// In your component
const handleSaveSystemConfig = async () => {
  try {
    const response = await api.quotations.updateProducts(quotationId, {
      systemType: updatedQuotation.products.systemType,
      panelBrand: updatedQuotation.products.panelBrand,
      panelSize: updatedQuotation.products.panelSize,
      panelQuantity: updatedQuotation.products.panelQuantity,
      // ... other product fields
      customPanels: updatedQuotation.products.customPanels // if systemType is 'customize'
    });
    
    if (response.success) {
      // Update local state with response
      setFullQuotation(response.data);
      toast.success("System configuration updated successfully");
    }
  } catch (error) {
    toast.error("Failed to update system configuration");
  }
};
```

---

### 2. Update Quotation Pricing
**Endpoint**: `PATCH /api/quotations/{quotationId}/pricing`

**Purpose**: Update pricing fields including subtotal, subsidies, discount, and final amount.

**Request Body**:
```typescript
{
  subtotal?: number,        // Optional - manual override of calculated subtotal
  stateSubsidy?: number,    // Optional - state subsidy amount
  centralSubsidy?: number,  // Optional - central subsidy amount
  discount?: number,        // Optional - discount percentage (0-100)
  finalAmount?: number      // Optional - manual override of calculated final amount
}
```

**Response** (200 OK):
```typescript
{
  success: true,
  data: {
    id: string,
    pricing: {
      subtotal: number,
      totalSubsidy: number,
      stateSubsidy: number,
      centralSubsidy: number,
      amountAfterSubsidy: number,
      discount: number,
      discountAmount: number,
      totalAmount: number,
      finalAmount: number
    },
    discount: number,
    subtotal: number,
    totalAmount: number,
    finalAmount: number,
    updatedAt: string
  }
}
```

**Example Usage**:
```typescript
// In your API client (lib/api.ts)
quotations: {
  // ... existing methods ...
  
  updatePricing: async (quotationId: string, pricing: {
    subtotal?: number
    stateSubsidy?: number
    centralSubsidy?: number
    discount?: number
    finalAmount?: number
  }) => {
    return apiRequest(`/quotations/${quotationId}/pricing`, {
      method: "PATCH",
      body: pricing,
    })
  },
}

// In your component
const handleSavePricing = async () => {
  try {
    // Prepare pricing data - only include defined values
    const pricingData: any = {};
    
    if (updatedQuotation.subtotal !== undefined && updatedQuotation.subtotal !== null) {
      pricingData.subtotal = Number(updatedQuotation.subtotal);
    }
    if (updatedQuotation.products?.stateSubsidy !== undefined && updatedQuotation.products?.stateSubsidy !== null) {
      pricingData.stateSubsidy = Number(updatedQuotation.products.stateSubsidy);
    }
    if (updatedQuotation.products?.centralSubsidy !== undefined && updatedQuotation.products?.centralSubsidy !== null) {
      pricingData.centralSubsidy = Number(updatedQuotation.products.centralSubsidy);
    }
    if (updatedQuotation.discount !== undefined && updatedQuotation.discount !== null) {
      pricingData.discount = Number(updatedQuotation.discount);
    }
    if (updatedQuotation.finalAmount !== undefined && updatedQuotation.finalAmount !== null) {
      pricingData.finalAmount = Number(updatedQuotation.finalAmount);
    }
    
    // Ensure at least one field is provided
    if (Object.keys(pricingData).length === 0) {
      toast.error("Please provide at least one pricing field to update");
      return;
    }
    
    console.log("Sending pricing update:", pricingData);
    
    const response = await api.quotations.updatePricing(quotationId, pricingData);
    
    console.log("Pricing update response:", response);
    
    if (response && response.success) {
      // Update local state with response
      setFullQuotation({
        ...fullQuotation,
        ...response.data.pricing,
        discount: response.data.discount,
        subtotal: response.data.subtotal,
        totalAmount: response.data.totalAmount,
        finalAmount: response.data.finalAmount
      });
      toast.success("Pricing updated successfully");
    } else {
      // Handle error response from API
      const errorMessage = response?.error?.message || "Failed to update pricing information";
      toast.error(errorMessage);
      console.error("Pricing update failed:", response);
      throw new Error(errorMessage);
    }
  } catch (error: any) {
    console.error("Pricing update error:", error);
    
    // Check if it's a validation error
    if (error?.response?.data?.error) {
      const errorData = error.response.data.error;
      const errorMsg = errorData.details?.[0]?.message || errorData.message || "Validation error";
      toast.error(errorMsg);
    } else if (error?.message) {
      toast.error(error.message);
    } else {
      toast.error("Failed to update pricing. Please check the console for details.");
    }
    throw error; // Re-throw to maintain error flow
  }
};
```

---

## Updated Endpoint

### Update Discount (Enhanced)
**Endpoint**: `PATCH /api/quotations/{quotationId}/discount`

**Change**: Now accepts both number and string (e.g., "0.00") for the discount value.

**Request Body**:
```typescript
{
  discount: number | string  // 0-100 (or "0" to "100")
}
```

**No breaking changes** - existing code will continue to work.

---

## Integration Steps

### Step 1: Update API Client
Add the new methods to your API client file (`lib/api.ts` or similar):

```typescript
quotations: {
  // ... existing methods ...
  
  updateProducts: async (quotationId: string, products: any) => {
    return apiRequest(`/quotations/${quotationId}/products`, {
      method: "PATCH",
      body: { products },
    })
  },
  
  updatePricing: async (quotationId: string, pricing: {
    subtotal?: number
    stateSubsidy?: number
    centralSubsidy?: number
    discount?: number
    finalAmount?: number
  }) => {
    return apiRequest(`/quotations/${quotationId}/pricing`, {
      method: "PATCH",
      body: pricing,
    })
  },
}
```

### Step 2: Update System Configuration Save Handler
In `components/quotation-details-dialog.tsx` (around line ~2158-2176):

**Before** (only local state update):
```typescript
const handleSaveSystemConfig = () => {
  setFullQuotation(updatedQuotation);
  // No API call
};
```

**After** (with API call):
```typescript
const handleSaveSystemConfig = async () => {
  try {
    const response = await api.quotations.updateProducts(quotationId, {
      systemType: updatedQuotation.products.systemType,
      panelBrand: updatedQuotation.products.panelBrand,
      panelSize: updatedQuotation.products.panelSize,
      panelQuantity: updatedQuotation.products.panelQuantity,
      // Include all product fields that were modified
      // ... other fields
      customPanels: updatedQuotation.products.customPanels // if systemType is 'customize'
    });
    
    if (response.success) {
      setFullQuotation(response.data);
      toast.success("System configuration updated successfully");
    }
  } catch (error) {
    toast.error("Failed to update system configuration");
    console.error(error);
  }
};
```

### Step 3: Update Pricing Summary Save Handler
In `components/quotation-details-dialog.tsx` (around line ~2409-2443):

**Before** (only discount persisted):
```typescript
const handleSavePricing = async () => {
  // Only discount is saved
  await api.quotations.updateDiscount(quotationId, discount);
  // Other fields only update local state
};
```

**After** (all pricing fields persisted):
```typescript
const handleSavePricing = async () => {
  try {
    const response = await api.quotations.updatePricing(quotationId, {
      subtotal: updatedQuotation.subtotal,
      stateSubsidy: updatedQuotation.products?.stateSubsidy,
      centralSubsidy: updatedQuotation.products?.centralSubsidy,
      discount: updatedQuotation.discount,
      finalAmount: updatedQuotation.finalAmount
    });
    
    if (response.success) {
      // Update local state with server response
      setFullQuotation({
        ...fullQuotation,
        ...response.data.pricing,
        discount: response.data.discount,
        subtotal: response.data.subtotal,
        totalAmount: response.data.totalAmount,
        finalAmount: response.data.finalAmount
      });
      toast.success("Pricing updated successfully");
    }
  } catch (error) {
    toast.error("Failed to update pricing");
    console.error(error);
  }
};
```

---

## Error Handling

All endpoints return standard error responses:

```typescript
{
  success: false,
  error: {
    code: string,        // Error code (e.g., 'VAL_001', 'RES_001')
    message: string,     // Human-readable error message
    details?: Array<{    // Optional validation details
      field?: string,
      message: string
    }>
  }
}
```

**Common Error Codes**:
- `AUTH_003`: User not authenticated
- `AUTH_004`: Insufficient permissions
- `RES_001`: Resource not found (quotation doesn't exist)
- `VAL_001`: Validation error
- `VAL_003`: Invalid product selection
- `SYS_001`: Internal server error

### Debugging Tips

If you encounter "Failed to update pricing information" error:

1. **Check the browser console** for the actual error response
2. **Verify the request payload** - ensure values are numbers, not strings (except discount can be string)
3. **Check network tab** - look at the actual request/response
4. **Ensure at least one field is provided** - the API requires at least one pricing field
5. **Check for undefined/null values** - filter them out before sending

**Example debugging code**:
```typescript
// Add before the API call
console.log("Pricing data being sent:", pricingData);
console.log("Quotation ID:", quotationId);

// Add after the API call
console.log("API Response:", response);

// Check for validation errors
if (!response.success && response.error) {
  console.error("Validation errors:", response.error.details);
}
```

---

## Validation Rules

### Products Endpoint:
- Products are validated against the product catalog
- Custom panels are required if `systemType` is 'customize'
- All product fields are optional (only provided fields are updated)

### Pricing Endpoint:
- `discount` must be between 0-100
- `subtotal` must be greater than 0
- Total subsidy (state + central) cannot exceed subtotal
- `finalAmount` must be between 0 and subtotal
- At least one pricing field must be provided

---

## Testing Checklist

- [ ] Update system configuration for DCR system type
- [ ] Update system configuration for NON-DCR system type
- [ ] Update system configuration for BOTH system type
- [ ] Update system configuration for CUSTOMIZE system type (with custom panels)
- [ ] Update pricing (subtotal, subsidies, discount, finalAmount)
- [ ] Test error handling for invalid data
- [ ] Test error handling for unauthorized access
- [ ] Verify `updatedAt` timestamp is updated
- [ ] Verify changes persist after page refresh

---

## Notes

1. **Partial Updates**: Both endpoints support partial updates - only send the fields you want to change
2. **Pricing Calculations**: The backend automatically calculates dependent fields (totalAmount, discountAmount, etc.) based on the provided values
3. **Permissions**: Dealers can only update their own quotations. Admins can update any quotation
4. **Custom Panels**: When updating to 'customize' system type, include the `customPanels` array. When changing away from 'customize', custom panels are automatically removed
5. **Backward Compatibility**: The existing `updateDiscount` endpoint still works and now accepts string numbers

---

## Migration Guide

If you're currently using only local state updates:

1. **System Configuration**: Replace `setFullQuotation(updatedQuotation)` with API call to `updateProducts`
2. **Pricing**: Replace local state updates with API call to `updatePricing`
3. **Discount**: No changes needed - existing `updateDiscount` calls will continue to work

---

## Questions?

If you encounter any issues or need clarification, please contact the backend team.
